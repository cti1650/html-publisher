// 書き込み系操作の可否判定の回帰テスト。
// MCP と REST の両方がこの判定を使うため、認証状態 × ID種別 × フラグの組み合わせを表で固定する。

import { describe, expect, it } from "vitest";
import type { AuthStatus } from "./auth";
import {
  CREATE_INPUT_ERROR,
  IMPORT_GIST_AUTH_ERROR,
  IMPORT_GIST_CACHE_ID_ERROR,
  PERSISTENT_UPDATE_AUTH_ERROR,
  TRUST_CONFIRMATION_ERROR,
  UPDATE_INPUT_ERROR,
  checkCreateInput,
  checkImportGistPermission,
  checkTrustConfirmation,
  checkUpdateInput,
  checkUpdatePermission,
  resolveEphemeral,
  toolPath,
} from "./policy";

const GIST_ID = "0123456789abcdef0123456789abcdef";
const CACHE_ID = "c_mva124pu-73547ffe";

describe("checkTrustConfirmation", () => {
  it.each([
    { trust: undefined, confirm: undefined, ok: true },
    { trust: false, confirm: undefined, ok: true },
    { trust: true, confirm: true, ok: true },
    { trust: true, confirm: undefined, ok: false },
    { trust: true, confirm: false, ok: false },
  ])("trust=$trust confirm_trust=$confirm → ok=$ok", ({ trust, confirm, ok }) => {
    const result = checkTrustConfirmation(trust, confirm);
    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.error).toBe(TRUST_CONFIRMATION_ERROR);
  });
});

describe("resolveEphemeral", () => {
  it.each<{ status: AuthStatus; ephemeral: boolean | undefined; expected: boolean | undefined }>([
    // 認証済みは指定どおり（未指定は storage 側のデフォルト判定に任せる）
    { status: "authenticated", ephemeral: undefined, expected: undefined },
    { status: "authenticated", ephemeral: false, expected: false },
    { status: "authenticated", ephemeral: true, expected: true },
    // 匿名は指定に関わらず揮発モード
    { status: "anonymous", ephemeral: undefined, expected: true },
    { status: "anonymous", ephemeral: false, expected: true },
    { status: "rejected", ephemeral: false, expected: true },
  ])("$status / ephemeral=$ephemeral → $expected", ({ status, ephemeral, expected }) => {
    expect(resolveEphemeral(status, ephemeral)).toBe(expected);
  });
});

describe("checkUpdatePermission", () => {
  it.each<{ status: AuthStatus; id: string; ok: boolean }>([
    { status: "authenticated", id: GIST_ID, ok: true },
    { status: "authenticated", id: CACHE_ID, ok: true },
    { status: "anonymous", id: CACHE_ID, ok: true },
    { status: "anonymous", id: GIST_ID, ok: false },
    { status: "rejected", id: GIST_ID, ok: false },
  ])("$status / $id → ok=$ok", ({ status, id, ok }) => {
    const result = checkUpdatePermission(status, id);
    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.error).toBe(PERSISTENT_UPDATE_AUTH_ERROR);
  });
});

describe("checkImportGistPermission", () => {
  it("認証済みで Gist ID なら許可", () => {
    expect(checkImportGistPermission("authenticated", GIST_ID)).toEqual({ ok: true });
  });

  it("揮発モードのIDは認証状態に関わらず拒否（ID種別のエラーを優先）", () => {
    expect(checkImportGistPermission("authenticated", CACHE_ID)).toEqual({
      ok: false,
      error: IMPORT_GIST_CACHE_ID_ERROR,
    });
    expect(checkImportGistPermission("anonymous", CACHE_ID)).toEqual({
      ok: false,
      error: IMPORT_GIST_CACHE_ID_ERROR,
    });
  });

  it("匿名は Gist ID でも拒否", () => {
    expect(checkImportGistPermission("anonymous", GIST_ID)).toEqual({
      ok: false,
      error: IMPORT_GIST_AUTH_ERROR,
    });
  });
});

describe("toolPath", () => {
  it("trust の有無で公開パスが切り替わる", () => {
    expect(toolPath(true)).toBe("tool-trust");
    expect(toolPath(false)).toBe("tool");
    expect(toolPath(undefined)).toBe("tool");
  });
});

describe("checkCreateInput", () => {
  const edits = [{ old_text: "a", new_text: "b" }];

  it.each([
    { input: { html: "<p>x</p>" }, ok: true },
    { input: { base_id: GIST_ID, edits }, ok: true },
    // どちらも無い・両方ある・片方だけ
    { input: {}, ok: false },
    { input: { html: "<p>x</p>", base_id: GIST_ID, edits }, ok: false },
    { input: { html: "<p>x</p>", edits }, ok: false },
    // 無改変の複製はできない
    { input: { base_id: GIST_ID }, ok: false },
    { input: { edits }, ok: false },
  ])("$input → ok=$ok", ({ input, ok }) => {
    const result = checkCreateInput(input);
    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.error).toBe(CREATE_INPUT_ERROR);
  });
});

describe("checkUpdateInput", () => {
  const edits = [{ old_text: "a", new_text: "b" }];

  it.each([
    { input: { html: "<p>x</p>" }, ok: true },
    { input: { edits }, ok: true },
    { input: {}, ok: false },
    { input: { html: "<p>x</p>", edits }, ok: false },
  ])("$input → ok=$ok", ({ input, ok }) => {
    const result = checkUpdateInput(input);
    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.error).toBe(UPDATE_INPUT_ERROR);
  });
});
