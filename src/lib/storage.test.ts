// 保存先（Gist / 揮発キャッシュ）の振り分けのテスト。
// 環境変数の組み合わせと ephemeral 指定で保存先が決まるため、その表を固定する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearServiceEnv } from "./test-env";

type StorageModule = typeof import("./storage");

async function loadStorage(): Promise<StorageModule> {
  // cache.ts のバックエンドはモジュール内で一度だけ生成されるため、テストごとに読み込み直す
  vi.resetModules();
  return import("./storage");
}

function configure({ gist, upstash }: { gist: boolean; upstash: boolean }) {
  clearServiceEnv();
  if (gist) vi.stubEnv("GITHUB_TOKEN", "test-token");
  if (upstash) {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  }
}

describe("pickMode", () => {
  it.each([
    { gist: true, upstash: true, ephemeral: undefined, expected: "gist" },
    { gist: true, upstash: true, ephemeral: true, expected: "cache" },
    { gist: true, upstash: false, ephemeral: undefined, expected: "gist" },
    { gist: true, upstash: false, ephemeral: true, expected: "cache" },
    // GITHUB_TOKEN が無く Upstash がある場合は自動で揮発モード
    { gist: false, upstash: true, ephemeral: undefined, expected: "cache" },
    { gist: false, upstash: true, ephemeral: false, expected: "cache" },
    // どちらも無い場合は gist を選び、createTool 側で設定不足のエラーにする
    { gist: false, upstash: false, ephemeral: undefined, expected: "gist" },
    { gist: false, upstash: false, ephemeral: true, expected: "cache" },
  ] as const)(
    "GITHUB_TOKEN=$gist / Upstash=$upstash / ephemeral=$ephemeral → $expected",
    async ({ gist, upstash, ephemeral, expected }) => {
      configure({ gist, upstash });
      const { pickMode } = await loadStorage();
      expect(pickMode(ephemeral)).toBe(expected);
    }
  );
});

describe("ストレージ未構成（ローカル開発の in-memory キャッシュ）", () => {
  let storage: StorageModule;

  beforeEach(async () => {
    configure({ gist: false, upstash: false });
    storage = await loadStorage();
  });

  it("ephemeral: true なら in-memory キャッシュに保存し、IDで読み書きできる", async () => {
    const created = await storage.createTool("<p>v1</p>", { name: "N", ephemeral: true });
    expect(created).toMatchObject({ mode: "cache", name: "N" });
    expect(created.id.startsWith("c_")).toBe(true);

    const updated = await storage.updateTool(created.id, "<p>v2</p>", { memo: "M" });
    expect(updated).toMatchObject({ id: created.id, mode: "cache", name: "N", memo: "M" });

    const detail = await storage.getTool(created.id);
    expect(detail).toMatchObject({ id: created.id, mode: "cache", name: "N", memo: "M" });
    expect(detail.html).toContain("<p>v2</p>");
  });

  it("ephemeral 未指定は GITHUB_TOKEN 不足のエラーになる", async () => {
    await expect(storage.createTool("<p>x</p>")).rejects.toThrow("GITHUB_TOKEN が設定されていません");
  });

  it("Gist ID の取得・更新は Tool not found になる（GitHub に問い合わせない）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(storage.getTool("0123456789abcdef")).rejects.toThrow("Tool not found");
    await expect(storage.updateTool("0123456789abcdef", "<p>x</p>")).rejects.toThrow("Tool not found");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("存在しない揮発IDは Tool not found", async () => {
    await expect(storage.getTool("c_missing-00000000")).rejects.toThrow("Tool not found");
    await expect(storage.updateTool("c_missing-00000000", "<p>x</p>")).rejects.toThrow("Tool not found");
  });

  it("一覧は GITHUB_TOKEN が無ければ空（揮発モードは一覧に含めない）", async () => {
    await storage.createTool("<p>x</p>", { ephemeral: true });
    expect(await storage.listRecentTools(10, "https://example.com")).toEqual([]);
  });
});
