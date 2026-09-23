// 公開前チェックのゲート（#13）の回帰テスト。
//
// 「既存クライアントが引数を追加せずに動き続ける」ことが絶対条件のため、
// HIGH が無いHTMLは confirm_security 無しで必ず通ることを固定する。

import { describe, expect, it } from "vitest";
import { evaluateSecurityGate } from "./gate";

let seed = 777001;
function rnd(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += chars[seed % chars.length];
  }
  return out;
}

const CLEAN = `<!DOCTYPE html><html><body><h1>hello</h1></body></html>`;
const MEDIUM_ONLY = `<!DOCTYPE html><html><body><script>fetch("https://api.example.com/x");</script></body></html>`;
const HIGH = `<!DOCTYPE html><html><body><script>const k="ghp_${rnd(36)}";</script></body></html>`;

describe("デフォルト非破壊（既存クライアントを壊さない）", () => {
  it("検出なしのHTMLは confirm_security 無しで通る", () => {
    const gate = evaluateSecurityGate(CLEAN);
    expect(gate.blocked).toBe(false);
    expect(gate.summary.risk).toBe("low");
  });

  it("MEDIUM だけならブロックしない", () => {
    const gate = evaluateSecurityGate(MEDIUM_ONLY);
    expect(gate.summary.summary.medium).toBeGreaterThan(0);
    expect(gate.summary.summary.high).toBe(0);
    expect(gate.blocked).toBe(false);
  });

  it("INFO だけならブロックしない", () => {
    const gate = evaluateSecurityGate(
      `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">`
    );
    expect(gate.summary.summary.high).toBe(0);
    expect(gate.blocked).toBe(false);
  });
});

describe("HIGH の扱い", () => {
  it("HIGH があり confirm_security が無ければブロックする", () => {
    const gate = evaluateSecurityGate(HIGH);
    expect(gate.summary.summary.high).toBeGreaterThan(0);
    expect(gate.blocked).toBe(true);
  });

  it("ブロック時のメッセージに検出内容と再実行方法を含める", () => {
    const gate = evaluateSecurityGate(HIGH);
    expect(gate.message).toContain("HIGH の検出");
    expect(gate.message).toContain("confirm_security: true");
    expect(gate.message).toContain("GitHub トークン");
    // 検出0件でも安全ではない旨は常に添える
    expect(gate.message).toContain("安全性の保証ではありません");
  });

  it("confirm_security: true なら HIGH があっても通る", () => {
    const gate = evaluateSecurityGate(HIGH, { confirmed: true });
    expect(gate.summary.summary.high).toBeGreaterThan(0);
    expect(gate.blocked).toBe(false);
  });

  it("confirm_security: false は未指定と同じ扱い（ブロックする）", () => {
    expect(evaluateSecurityGate(HIGH, { confirmed: false }).blocked).toBe(true);
  });
});

describe("レスポンスに添える要約", () => {
  it("HIGH / MEDIUM は含め、INFO は含めない", () => {
    const html = `<!DOCTYPE html><html><body>
      <script>const k="ghp_${rnd(36)}"; fetch("https://api.example.com/x"); localStorage.setItem("a","b");</script>
      </body></html>`;
    const gate = evaluateSecurityGate(html, { confirmed: true });
    const severities = new Set(gate.summary.findings.map((f) => f.severity));
    expect(severities.has("high")).toBe(true);
    expect(severities.has("info")).toBe(false);
    // storage-usage は INFO なので findings には出ないが、集計には残る
    expect(gate.summary.summary.info).toBeGreaterThan(0);
  });

  it("要約に秘密情報の実値を含めない", () => {
    const key = `ghp_${rnd(36)}`;
    const gate = evaluateSecurityGate(
      `<html><body><script>const k="${key}";</script></body></html>`,
      { confirmed: true }
    );
    expect(JSON.stringify(gate.summary)).not.toContain(key);
  });

  it("trustRequired の判定を引き継ぐ", () => {
    const gate = evaluateSecurityGate(
      `<html><body><script>localStorage.setItem("a","b");</script></body></html>`
    );
    expect(gate.summary.recommendation.trustRequired).toBe(true);
    expect(gate.blocked).toBe(false);
  });

  it("selfOrigin を渡すと自オリジンへの絶対URLを同一オリジンとして扱う", () => {
    const html = `<html><body><script>fetch("https://publisher.example.com/api/tools");</script></body></html>`;
    const gate = evaluateSecurityGate(html, { selfOrigin: "https://publisher.example.com" });
    expect(gate.summary.findings.some((f) => f.id === "same-origin-api-request")).toBe(true);
    expect(gate.blocked).toBe(true);
  });
});
