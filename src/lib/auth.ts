import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export type AuthStatus = "authenticated" | "anonymous" | "rejected";

export interface AuthContext {
  status: AuthStatus;
}

// MCPツールハンドラーは request オブジェクトを直接受け取らないため、
// AsyncLocalStorage で wrapper → handler に認証状態を伝搬する。
export const authContext = new AsyncLocalStorage<AuthContext>();

export function generateApiKey(secret: string, githubToken: string): string {
  return createHash("sha256")
    .update(secret + githubToken)
    .digest("hex");
}

export function checkAuth(request: NextRequest | Request): AuthStatus {
  const url = new URL(request.url);
  const keyFromQuery = url.searchParams.get("key");
  const keyFromHeader = request.headers.get("x-api-key");
  const providedKey = keyFromQuery || keyFromHeader;

  const secret = process.env.SECRET;
  const githubToken = process.env.GITHUB_TOKEN;

  // キー未提示 → anonymous（揮発モード専用で利用可）
  if (!providedKey) {
    return "anonymous";
  }

  // キーが提示されたが検証材料が無い → 検証不能のため anonymous 扱い
  if (!secret || !githubToken) {
    return "anonymous";
  }

  const expectedKey = generateApiKey(secret, githubToken);
  return providedKey === expectedKey ? "authenticated" : "rejected";
}

export function isAuthenticated(request: NextRequest | Request): boolean {
  return checkAuth(request) === "authenticated";
}

// 旧 verifyApiKey は「許可されているか（rejected でない）」のチェックとして残す。
// 認証済みかどうかは isAuthenticated を使う。
export function verifyApiKey(request: NextRequest | Request): boolean {
  return checkAuth(request) !== "rejected";
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export interface AuthCapabilities {
  status: AuthStatus;
  label: string;
  summary: string;
  forcedEphemeral: boolean;
  canCreatePersistent: boolean;
  canCreateEphemeral: boolean;
  canUpdatePersistent: boolean;
  canUpdateEphemeral: boolean;
  canImportGist: boolean;
  canReadTools: boolean;
}

export function getAuthCapabilities(status: AuthStatus): AuthCapabilities {
  if (status === "authenticated") {
    return {
      status,
      label: "認証済み",
      summary:
        "正しいAPIキーで接続中。永続モード（Gist）・揮発モード（Cache）の作成/更新、および import_gist が利用可能",
      forcedEphemeral: false,
      canCreatePersistent: true,
      canCreateEphemeral: true,
      canUpdatePersistent: true,
      canUpdateEphemeral: true,
      canImportGist: true,
      canReadTools: true,
    };
  }
  if (status === "anonymous") {
    return {
      status,
      label: "匿名",
      summary:
        "APIキー未提示。揮発モード（Cache）のみ作成・更新可。create_tool は ephemeral 指定に関わらず揮発モード強制。永続Gistの更新および import_gist は認証必須のため利用不可",
      forcedEphemeral: true,
      canCreatePersistent: false,
      canCreateEphemeral: true,
      canUpdatePersistent: false,
      canUpdateEphemeral: true,
      canImportGist: false,
      canReadTools: true,
    };
  }
  return {
    status,
    label: "拒否",
    summary: "APIキーが不正。全リクエストが401で拒否されます",
    forcedEphemeral: false,
    canCreatePersistent: false,
    canCreateEphemeral: false,
    canUpdatePersistent: false,
    canUpdateEphemeral: false,
    canImportGist: false,
    canReadTools: false,
  };
}
