import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export function generateApiKey(secret: string, githubToken: string): string {
  return createHash("sha256")
    .update(secret + githubToken)
    .digest("hex");
}

export function verifyApiKey(request: NextRequest | Request): boolean {
  const url = new URL(request.url);
  const keyFromQuery = url.searchParams.get("key");
  const keyFromHeader = request.headers.get("x-api-key");
  const providedKey = keyFromQuery || keyFromHeader;

  const secret = process.env.SECRET;
  const githubToken = process.env.GITHUB_TOKEN;

  // SECRETが設定されていない場合は認証をスキップ（開発環境用）
  if (!secret) {
    return true;
  }

  if (!githubToken || !providedKey) {
    return false;
  }

  const expectedKey = generateApiKey(secret, githubToken);
  return providedKey === expectedKey;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
