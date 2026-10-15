// テスト用: 外部サービスに繋がる環境変数を空にする。
// 開発者のシェルや .env の値に左右されず、未設定の状態から各テストで必要なものだけを設定するために使う。

import { vi } from "vitest";

export function clearServiceEnv(): void {
  for (const key of [
    "SECRET",
    "GITHUB_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "CACHE_TTL_SECONDS",
    "SLACK_WEBHOOK_URL",
  ]) {
    vi.stubEnv(key, "");
  }
}
