// 揮発モード（in-memory バックエンド）のテスト。
// バックエンドはモジュール内で一度だけ生成されるため、テストごとにモジュールを読み込み直して状態を分離する。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearServiceEnv } from "./test-env";

type CacheModule = typeof import("./cache");

async function loadCache(): Promise<CacheModule> {
  vi.resetModules();
  return import("./cache");
}

const HTML = "<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>";
const HOUR = 60 * 60 * 1000;

describe("isCacheId", () => {
  it("c_ で始まるIDだけを揮発モードと判定する", async () => {
    const { isCacheId } = await loadCache();
    expect(isCacheId("c_abc-12345678")).toBe(true);
    expect(isCacheId("0123456789abcdef")).toBe(false);
    expect(isCacheId("C_abc")).toBe(false);
  });
});

describe("isCacheEnabled", () => {
  beforeEach(() => clearServiceEnv());

  it("Upstash の URL と TOKEN が両方あるときだけ有効", async () => {
    const { isCacheEnabled } = await loadCache();
    expect(isCacheEnabled()).toBe(false);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    expect(isCacheEnabled()).toBe(false);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(isCacheEnabled()).toBe(true);
  });
});

describe("in-memory バックエンド", () => {
  let cache: CacheModule;

  beforeEach(async () => {
    clearServiceEnv();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    cache = await loadCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("作成したエントリをIDで取得できる", async () => {
    const created = await cache.createCacheEntry(HTML, { name: "N", memo: "M", trust: true });
    expect(created.id).toMatch(/^c_[0-9a-z]+-[0-9a-f]{8}$/);
    expect(created).toMatchObject({ name: "N", memo: "M", trust: true });

    const entry = await cache.getCacheEntry(created.id);
    expect(entry).toMatchObject({ id: created.id, name: "N", memo: "M", trust: true });
    // 保存時に Prettier で整形される
    expect(entry?.html).toContain("<body>\n    hi\n  </body>");
  });

  it("存在しないID・揮発モードでないIDは null", async () => {
    expect(await cache.getCacheEntry("c_missing-00000000")).toBeNull();
    expect(await cache.getCacheEntry("0123456789abcdef")).toBeNull();
    expect(await cache.updateCacheEntry("c_missing-00000000", HTML)).toBeNull();
  });

  it("更新では未指定のメタ情報を引き継ぎ、指定した項目だけ上書きする", async () => {
    const { id } = await cache.createCacheEntry(HTML, { name: "N", memo: "M", trust: true });
    const updated = await cache.updateCacheEntry(id, "<p>new</p>", { memo: "M2", trust: false });
    expect(updated).toEqual({ id, name: "N", memo: "M2", trust: false });

    const entry = await cache.getCacheEntry(id);
    expect(entry?.html).toContain("<p>new</p>");
  });

  it("最終アクセスから TTL を過ぎると消える（デフォルト6時間）", async () => {
    const { id } = await cache.createCacheEntry(HTML);
    vi.advanceTimersByTime(5 * HOUR);
    expect(await cache.getCacheEntry(id)).not.toBeNull();
    // 直前の読み込みで TTL が延長されているため、作成から 11 時間後でも残る
    vi.advanceTimersByTime(6 * HOUR - 1000);
    expect(await cache.getCacheEntry(id)).not.toBeNull();
    vi.advanceTimersByTime(6 * HOUR + 1000);
    expect(await cache.getCacheEntry(id)).toBeNull();
  });

  it("CACHE_TTL_SECONDS で TTL を変更できる", async () => {
    vi.stubEnv("CACHE_TTL_SECONDS", "60");
    const { id } = await cache.createCacheEntry(HTML);
    vi.advanceTimersByTime(59 * 1000);
    expect(await cache.getCacheEntry(id)).not.toBeNull();
    vi.advanceTimersByTime(61 * 1000);
    expect(await cache.getCacheEntry(id)).toBeNull();
  });

  it.each(["abc", "0", "-10"])("CACHE_TTL_SECONDS=%s のような不正値はデフォルト6時間にする", async (value) => {
    vi.stubEnv("CACHE_TTL_SECONDS", value);
    const { id } = await cache.createCacheEntry(HTML);
    vi.advanceTimersByTime(6 * HOUR - 1000);
    expect(await cache.getCacheEntry(id)).not.toBeNull();
  });

  it("一覧は更新が新しい順で、期限切れは含まない", async () => {
    const a = await cache.createCacheEntry("<p>a</p>", { name: "a" });
    vi.advanceTimersByTime(1000);
    const b = await cache.createCacheEntry("<p>b</p>", { name: "b", trust: true });
    vi.advanceTimersByTime(1000);
    await cache.updateCacheEntry(a.id, "<p>a2</p>");

    const list = await cache.listRecentCacheEntries(10, "https://example.com");
    expect(list.map((t) => t.name)).toEqual(["a", "b"]);
    expect(list[1].url).toBe(`https://example.com/tool-trust/${b.id}`);
    expect(await cache.listRecentCacheEntries(1, "https://example.com")).toHaveLength(1);

    vi.advanceTimersByTime(7 * HOUR);
    expect(await cache.listRecentCacheEntries(10, "https://example.com")).toEqual([]);
  });
});
