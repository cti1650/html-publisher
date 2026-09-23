// Secret 検出の回帰テスト（#11）。
//
// 検出漏れと誤検知の両方を固定する。特に誤検知は
// 「正当なHTMLが公開できなくなる」形で体験を壊すため、
// Base64画像・ハッシュ・プレースホルダ等を明示的に守る。

import { describe, expect, it } from "vitest";
import { scanHtml } from "./index";
import { shannonEntropy } from "./secrets";

// 合成キーは連番だとプレースホルダ判定で弾かれるため、再現性のある擬似乱数で作る
let seed = 20260923;
function rnd(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += chars[seed % chars.length];
  }
  return out;
}

const wrap = (js: string) => `<!DOCTYPE html><html><body><script>${js}</script></body></html>`;
const secrets = (html: string) => scanHtml(html).findings.filter((f) => f.id === "hardcoded-secret");

describe("プロバイダ固有キーの検出", () => {
  const cases: [string, string][] = [
    ["OpenAI APIキー", wrap(`const k="sk-proj-${rnd(48)}";`)],
    ["Anthropic APIキー", wrap(`const k="sk-ant-api03-${rnd(95)}";`)],
    ["GitHub トークン", wrap(`const k="ghp_${rnd(36)}";`)],
    ["GitHub fine-grained PAT", wrap(`const k="github_pat_${rnd(22)}_${rnd(59)}";`)],
    ["Slack トークン", wrap(`const k="xoxb-123456789012-1234567890123-${rnd(24)}";`)],
    ["AWS アクセスキーID", wrap(`const k="AKIA${rnd(16).toUpperCase()}";`)],
    ["Stripe シークレットキー", wrap(`const k="sk_live_${rnd(24)}";`)],
    ["SendGrid APIキー", wrap(`const k="SG.${rnd(22)}.${rnd(43)}";`)],
    ["GitLab PAT", wrap(`const k="glpat-${rnd(20)}";`)],
    ["Google OAuth クライアントシークレット", wrap(`const s="GOCSPX-${rnd(28)}";`)],
    ["npm トークン", wrap(`const k="npm_${rnd(36)}";`)],
    ["Telegram Bot トークン", wrap(`const k="1234567890:AA${rnd(33)}";`)],
    ["秘密鍵ブロック", `<pre>-----BEGIN RSA PRIVATE KEY-----\n${rnd(64)}\n-----END RSA PRIVATE KEY-----</pre>`],
  ];

  for (const [provider, html] of cases) {
    it(`${provider} を HIGH で検出し、プロバイダ名を含める`, () => {
      const found = secrets(html);
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].severity).toBe("high");
      expect(found.map((f) => f.target).join()).toContain(provider);
      expect(found[0].message).toContain(provider);
    });
  }
});

describe("プロバイダを特定できないシークレット", () => {
  it("変数名がシークレットらしく値のエントロピーが高いものを検出する", () => {
    const found = secrets(wrap(`const apiSecret = "${rnd(40)}";`));
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("high");
    expect(found[0].target).toContain("apiSecret");
  });

  it("接続文字列に埋め込まれたパスワードを検出する", () => {
    const found = secrets(wrap(`const url="postgres://admin:${rnd(20)}@db.example.com:5432/app";`));
    expect(found.map((f) => f.target).join()).toContain("接続文字列");
  });

  it("URLに埋め込んだ Basic 認証を検出する", () => {
    const found = secrets(wrap(`fetch("https://user:${rnd(18)}@api.example.com/v1");`));
    expect(found.length).toBeGreaterThan(0);
  });

  it("JWT を検出する", () => {
    const found = secrets(wrap(`const t="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.${rnd(43)}";`));
    expect(found.map((f) => f.target).join()).toContain("JWT");
  });

  it("変数名がシークレットらしくなければ検出しない", () => {
    expect(secrets(wrap(`const sessionId = "${rnd(40)}";`))).toHaveLength(0);
  });
});

describe("公開前提のキーは MEDIUM にとどめる", () => {
  it("Firebase Web APIキー（AIza）は MEDIUM かつ注意書きを含む", () => {
    const found = secrets(wrap(`const firebaseConfig={apiKey:"AIza${rnd(35)}"};`));
    expect(found[0].severity).toBe("medium");
    expect(found[0].message).toContain("公開前提");
  });

  it("Stripe 公開可能キー（pk_）は MEDIUM", () => {
    const found = secrets(wrap(`const k="pk_live_${rnd(24)}";`));
    expect(found[0].severity).toBe("medium");
    expect(found[0].message).toContain("publishable");
  });

  it("Stripe テストキー（sk_test_）は MEDIUM", () => {
    expect(secrets(wrap(`const k="sk_test_${rnd(24)}";`))[0].severity).toBe("medium");
  });
});

describe("誤検知の抑制", () => {
  const cases: [string, string][] = [
    ["Base64画像 data URI", `<img src="data:image/png;base64,${rnd(400)}">`],
    ["Base64フォント", `<style>@font-face{src:url(data:font/woff2;base64,${rnd(600)})}</style>`],
    ["SHA-256 ハッシュ定数", wrap(`const CHECKSUM="a3f5c9e2b7d148f6a0c3e5b9d7f1a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6";`)],
    ["SRI integrity 属性", `<script src="https://cdn.example.com/x.js" integrity="sha384-${rnd(64)}"></script>`],
    ["UUID", wrap(`const id="550e8400-e29b-41d4-a716-446655440000";`)],
    ["プレースホルダ（your_）", wrap(`const apiKey="your_api_key_here";`)],
    ["プレースホルダ（xxxx）", wrap(`const k="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";`)],
    ["サンプル値（example）", wrap(`const k="ghp_exampleexampleexampleexampleexam";`)],
    ["ミニファイされたコード", wrap(`function a(b,c){return b.split("").reverse().join("")+c}`)],
    [
      "長いクラス名の羅列",
      `<div class="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm"></div>`,
    ],
    ["普通の文章", `<p>このツールは勤務時間を集計して、勤怠システム用の形式へ変換します。</p>`],
    ["データとしてのランダムID", wrap(`const ids=["${rnd(21)}","${rnd(21)}"];`)],
    ["カラーコードの配列", wrap(`const palette=["#1f2937","#374151","#4b5563"];`)],
    ["Google Fonts URL", `<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap" rel="stylesheet">`],
  ];

  for (const [label, html] of cases) {
    it(`${label} を秘密情報として検出しない`, () => {
      expect(secrets(html)).toHaveLength(0);
    });
  }
});

describe("出力の扱い", () => {
  it("値はマスクして出力する（全文を含めない）", () => {
    const key = `ghp_${rnd(36)}`;
    const found = secrets(wrap(`const k="${key}";`));
    expect(found[0].evidence).not.toContain(key);
    expect(found[0].evidence).toContain(key.slice(0, 6));
    expect(found[0].evidence).toContain("文字）");
  });

  it("同じプロバイダの複数検出はまとめて count に反映する", () => {
    const html = wrap(`const a="ghp_${rnd(36)}"; const b="ghp_${rnd(36)}";`);
    const found = secrets(html);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
  });

  it("audience は publisher（公開した本人のリスク）", () => {
    expect(secrets(wrap(`const k="ghp_${rnd(36)}";`))[0].audience).toEqual(["publisher"]);
  });
});

describe("エントロピー計算", () => {
  it("ランダムな base62 列は高く、繰り返しは低い", () => {
    expect(shannonEntropy(rnd(40))).toBeGreaterThan(4);
    expect(shannonEntropy("aaaaaaaaaaaaaaaaaaaa")).toBeLessThan(1);
  });

  it("空文字は 0", () => {
    expect(shannonEntropy("")).toBe(0);
  });
});
