import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
import * as prettier from "prettier";

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const RECENT_KEY = "tools:recent";
const RECENT_LIMIT = 100;

interface CacheOptions {
  name?: string;
  memo?: string;
  trust?: boolean;
}

interface CacheEntry {
  html: string;
  name?: string;
  memo?: string;
  trust?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CacheBackend {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: CacheEntry, ttl: number): Promise<void>;
  expire(key: string, ttl: number): Promise<void>;
  del(key: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
}

class UpstashBackend implements CacheBackend {
  constructor(private redis: Redis) {}

  async get(key: string): Promise<CacheEntry | null> {
    const value = await this.redis.get<CacheEntry>(key);
    return value ?? null;
  }

  async set(key: string, value: CacheEntry, ttl: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttl });
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.redis.expire(key, ttl);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.redis.zadd(key, { score, member });
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const result = await this.redis.zrange<string[]>(key, start, stop, { rev: true });
    return result ?? [];
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.redis.zrem(key, member);
  }
}

class InMemoryBackend implements CacheBackend {
  private store = new Map<string, { value: CacheEntry; expiresAt: number }>();
  private sortedSets = new Map<string, Map<string, number>>();

  private gc() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        for (const set of this.sortedSets.values()) {
          set.delete(key);
        }
      }
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    this.gc();
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: CacheEntry, ttl: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async expire(key: string, ttl: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttl * 1000;
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = new Map();
      this.sortedSets.set(key, set);
    }
    set.set(member, score);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    this.gc();
    const set = this.sortedSets.get(key);
    if (!set) return [];
    const sorted = [...set.entries()]
      .filter(([m]) => this.store.has(m))
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
    return sorted.slice(start, stop + 1);
  }

  async zrem(key: string, member: string): Promise<void> {
    this.sortedSets.get(key)?.delete(member);
  }
}

let cachedBackend: CacheBackend | null = null;

function getBackend(): CacheBackend {
  if (cachedBackend) return cachedBackend;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    cachedBackend = new UpstashBackend(new Redis({ url, token }));
  } else {
    cachedBackend = new InMemoryBackend();
  }

  return cachedBackend;
}

function getTtl(): number {
  const raw = process.env.CACHE_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

export function isCacheEnabled(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function isCacheId(id: string): boolean {
  return id.startsWith("c_");
}

function generateId(html: string): string {
  const timestamp = Date.now().toString(36);
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 8);
  return `c_${timestamp}-${hash}`;
}

async function formatHtml(html: string): Promise<string> {
  try {
    return await prettier.format(html, {
      parser: "html",
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
    });
  } catch {
    return html;
  }
}

export async function createCacheEntry(
  html: string,
  options?: CacheOptions
): Promise<{
  id: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}> {
  const backend = getBackend();
  const ttl = getTtl();
  const id = generateId(html);
  const content = await formatHtml(html);
  const now = new Date().toISOString();

  const entry: CacheEntry = {
    html: content,
    name: options?.name,
    memo: options?.memo,
    trust: options?.trust,
    createdAt: now,
    updatedAt: now,
  };

  await backend.set(id, entry, ttl);
  await backend.zadd(RECENT_KEY, Date.now(), id);

  return {
    id,
    name: entry.name,
    memo: entry.memo,
    trust: entry.trust,
  };
}

export async function getCacheEntry(id: string): Promise<{
  id: string;
  html: string;
  name?: string;
  memo?: string;
  trust?: boolean;
  updatedAt: string;
} | null> {
  if (!isCacheId(id)) return null;

  const backend = getBackend();
  const entry = await backend.get(id);
  if (!entry) return null;

  // Sliding TTL: extend on every read
  await backend.expire(id, getTtl());

  return {
    id,
    html: entry.html,
    name: entry.name,
    memo: entry.memo,
    trust: entry.trust,
    updatedAt: entry.updatedAt,
  };
}

export async function updateCacheEntry(
  id: string,
  html: string,
  options?: CacheOptions
): Promise<{
  id: string;
  name?: string;
  memo?: string;
  trust?: boolean;
} | null> {
  if (!isCacheId(id)) return null;

  const backend = getBackend();
  const existing = await backend.get(id);
  if (!existing) return null;

  const merged: CacheEntry = {
    html: await formatHtml(html),
    name: options?.name ?? existing.name,
    memo: options?.memo ?? existing.memo,
    trust: options?.trust ?? existing.trust,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await backend.set(id, merged, getTtl());
  await backend.zadd(RECENT_KEY, Date.now(), id);

  return {
    id,
    name: merged.name,
    memo: merged.memo,
    trust: merged.trust,
  };
}

export interface CacheToolSummary {
  id: string;
  name?: string;
  memo?: string;
  trust?: boolean;
  url: string;
  updatedAt: string;
}

export async function listRecentCacheEntries(
  limit: number,
  baseUrl: string
): Promise<CacheToolSummary[]> {
  const backend = getBackend();
  const ids = await backend.zrevrange(RECENT_KEY, 0, RECENT_LIMIT - 1);

  const results: CacheToolSummary[] = [];
  for (const id of ids) {
    if (results.length >= limit) break;
    const entry = await backend.get(id);
    if (!entry) {
      // expired but lingering in sorted set; clean up
      await backend.zrem(RECENT_KEY, id);
      continue;
    }
    const toolPath = entry.trust ? "tool-trust" : "tool";
    results.push({
      id,
      name: entry.name,
      memo: entry.memo,
      trust: entry.trust,
      url: `${baseUrl}/${toolPath}/${id}`,
      updatedAt: entry.updatedAt,
    });
  }

  return results;
}
