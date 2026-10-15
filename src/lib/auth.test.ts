// 認証判定の回帰テスト。
// checkAuth の3状態（authenticated / anonymous / rejected）が書き込み可否の起点になるため、
// キーの提示方法と環境変数の有無の組み合わせを固定する。

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAuth, generateApiKey, getAuthCapabilities, isAuthenticated, verifyApiKey } from "./auth";
import { clearServiceEnv } from "./test-env";

const SECRET = "test-secret";
const TOKEN = "test-github-token";
const VALID_KEY = createHash("sha256").update(SECRET + TOKEN).digest("hex");

function request(options: { query?: string; header?: string } = {}): Request {
  const url = new URL("http://localhost/api/tools");
  if (options.query !== undefined) url.searchParams.set("key", options.query);
  const headers = new Headers();
  if (options.header !== undefined) headers.set("x-api-key", options.header);
  return new Request(url, { headers });
}

describe("generateApiKey", () => {
  it("SECRET と GITHUB_TOKEN を連結した SHA-256 の16進表記を返す", () => {
    expect(generateApiKey(SECRET, TOKEN)).toBe(VALID_KEY);
    expect(generateApiKey(SECRET, TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("入力が変わればキーも変わる", () => {
    expect(generateApiKey(SECRET, "other")).not.toBe(VALID_KEY);
  });
});

describe("checkAuth", () => {
  beforeEach(() => {
    clearServiceEnv();
    vi.stubEnv("SECRET", SECRET);
    vi.stubEnv("GITHUB_TOKEN", TOKEN);
  });

  it("キー未提示は anonymous", () => {
    expect(checkAuth(request())).toBe("anonymous");
  });

  it("クエリの正しいキーは authenticated", () => {
    expect(checkAuth(request({ query: VALID_KEY }))).toBe("authenticated");
  });

  it("ヘッダーの正しいキーは authenticated", () => {
    expect(checkAuth(request({ header: VALID_KEY }))).toBe("authenticated");
  });

  it("誤ったキーは rejected", () => {
    expect(checkAuth(request({ query: "wrong" }))).toBe("rejected");
    expect(checkAuth(request({ header: "wrong" }))).toBe("rejected");
  });

  it("クエリとヘッダーの両方がある場合はクエリが優先される", () => {
    expect(checkAuth(request({ query: "wrong", header: VALID_KEY }))).toBe("rejected");
    expect(checkAuth(request({ query: VALID_KEY, header: "wrong" }))).toBe("authenticated");
  });

  it("SECRET 未設定ならキーを検証できないため anonymous 扱い", () => {
    vi.stubEnv("SECRET", "");
    expect(checkAuth(request({ query: VALID_KEY }))).toBe("anonymous");
  });

  it("GITHUB_TOKEN 未設定ならキーを検証できないため anonymous 扱い", () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(checkAuth(request({ query: VALID_KEY }))).toBe("anonymous");
  });

  it("isAuthenticated は authenticated のときだけ true", () => {
    expect(isAuthenticated(request({ query: VALID_KEY }))).toBe(true);
    expect(isAuthenticated(request())).toBe(false);
    expect(isAuthenticated(request({ query: "wrong" }))).toBe(false);
  });

  it("verifyApiKey は rejected 以外で true", () => {
    expect(verifyApiKey(request({ query: VALID_KEY }))).toBe(true);
    expect(verifyApiKey(request())).toBe(true);
    expect(verifyApiKey(request({ query: "wrong" }))).toBe(false);
  });
});

describe("getAuthCapabilities", () => {
  it("authenticated は全操作が可能で揮発モードの強制なし", () => {
    const cap = getAuthCapabilities("authenticated");
    expect(cap.forcedEphemeral).toBe(false);
    expect(cap).toMatchObject({
      canCreatePersistent: true,
      canCreateEphemeral: true,
      canUpdatePersistent: true,
      canUpdateEphemeral: true,
      canImportGist: true,
      canReadTools: true,
    });
  });

  it("anonymous は揮発モードのみ書き込み可能で、作成は揮発モードに強制される", () => {
    const cap = getAuthCapabilities("anonymous");
    expect(cap.forcedEphemeral).toBe(true);
    expect(cap).toMatchObject({
      canCreatePersistent: false,
      canCreateEphemeral: true,
      canUpdatePersistent: false,
      canUpdateEphemeral: true,
      canImportGist: false,
      canReadTools: true,
    });
  });

  it("rejected は全操作が不可", () => {
    const cap = getAuthCapabilities("rejected");
    expect(cap).toMatchObject({
      canCreatePersistent: false,
      canCreateEphemeral: false,
      canUpdatePersistent: false,
      canUpdateEphemeral: false,
      canImportGist: false,
      canReadTools: false,
    });
  });
});
