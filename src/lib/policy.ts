// 書き込み系操作の可否判定。
//
// MCP（src/app/api/mcp/[transport]/route.ts）と REST（src/app/api/tools/**）の両方から使う。
// 認証の境界になる判定なので、ルートハンドラーに直書きせずここに集約してテストで固定する（policy.test.ts）。

import type { AuthStatus } from "@/lib/auth";
import { isCacheId } from "@/lib/cache";

export type PolicyResult = { ok: true } | { ok: false; error: string };

const OK: PolicyResult = { ok: true };

export const TRUST_CONFIRMATION_ERROR =
  "trust: trueを指定する場合はconfirm_trust: trueも必要です。信頼モードはセキュリティ制限が無効化されます。ユーザーに確認を取ってから再実行してください。";

export const PERSISTENT_UPDATE_AUTH_ERROR =
  "永続モード（Gist）の更新には認証が必要です。揮発モード（c_で始まるID）のみ匿名で更新可能です";

export const IMPORT_GIST_CACHE_ID_ERROR =
  "import_gistは揮発モード（c_で始まるID）には使用できません。Gist IDを指定してください";

export const IMPORT_GIST_AUTH_ERROR = "import_gistの実行には認証が必要です。APIキーを設定してください";

/** trust: true には confirm_trust: true を必須にする（MCP のみ） */
export function checkTrustConfirmation(trust?: boolean, confirmTrust?: boolean): PolicyResult {
  if (trust && !confirmTrust) return { ok: false, error: TRUST_CONFIRMATION_ERROR };
  return OK;
}

/** 匿名アクセスは揮発モード固定（永続モード=Gist書き込みは認証必須） */
export function resolveEphemeral(status: AuthStatus, ephemeral?: boolean): boolean | undefined {
  return status === "authenticated" ? ephemeral : true;
}

/** 永続モード（Gist）の更新は認証必須。匿名は揮発モードのみ更新可 */
export function checkUpdatePermission(status: AuthStatus, id: string): PolicyResult {
  if (status !== "authenticated" && !isCacheId(id)) {
    return { ok: false, error: PERSISTENT_UPDATE_AUTH_ERROR };
  }
  return OK;
}

/** import_gist は Gist 専用かつ Gist 書き込みを伴うため認証必須 */
export function checkImportGistPermission(status: AuthStatus, id: string): PolicyResult {
  if (isCacheId(id)) return { ok: false, error: IMPORT_GIST_CACHE_ID_ERROR };
  if (status !== "authenticated") return { ok: false, error: IMPORT_GIST_AUTH_ERROR };
  return OK;
}

/** ツール公開URLのパス */
export function toolPath(trust?: boolean): "tool" | "tool-trust" {
  return trust ? "tool-trust" : "tool";
}
