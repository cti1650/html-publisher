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
