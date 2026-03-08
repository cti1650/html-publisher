import { NextRequest, NextResponse } from "next/server";

export function verifyApiKey(request: NextRequest | Request): boolean {
  const url = new URL(request.url);
  const keyFromQuery = url.searchParams.get("key");
  const keyFromHeader = request.headers.get("x-api-key");
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    // API_KEYが設定されていない場合は認証をスキップ（開発環境用）
    return true;
  }

  return keyFromQuery === apiKey || keyFromHeader === apiKey;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
