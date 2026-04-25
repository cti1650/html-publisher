import {
  createGist,
  getGist,
  updateGist,
  listRecentGists,
  type ToolSummary,
} from "@/lib/gist";
import {
  createCacheEntry,
  getCacheEntry,
  updateCacheEntry,
  listRecentCacheEntries,
  isCacheEnabled,
  isCacheId,
} from "@/lib/cache";

export type StorageMode = "gist" | "cache";

export interface ToolMeta {
  name?: string;
  memo?: string;
  trust?: boolean;
}

export interface CreateOptions extends ToolMeta {
  ephemeral?: boolean;
}

export interface CreateResult {
  id: string;
  mode: StorageMode;
  rawUrl?: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}

export interface ToolDetail {
  id: string;
  mode: StorageMode;
  html: string;
  rawUrl?: string;
  htmlUrl?: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}

export interface UpdateResult {
  id: string;
  mode: StorageMode;
  rawUrl?: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}

function gistAvailable(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function pickMode(ephemeral?: boolean): StorageMode {
  if (ephemeral) return "cache";
  if (!gistAvailable() && isCacheEnabled()) return "cache";
  return "gist";
}

export async function createTool(
  html: string,
  options?: CreateOptions
): Promise<CreateResult> {
  const mode = pickMode(options?.ephemeral);

  if (mode === "cache") {
    if (!isCacheEnabled() && !options?.ephemeral && !gistAvailable()) {
      throw new Error(
        "ストレージが構成されていません。GITHUB_TOKEN または UPSTASH_REDIS_REST_URL/TOKEN を設定してください"
      );
    }
    const result = await createCacheEntry(html, options);
    return {
      id: result.id,
      mode: "cache",
      name: result.name,
      memo: result.memo,
      trust: result.trust,
    };
  }

  if (!gistAvailable()) {
    throw new Error("GITHUB_TOKEN が設定されていません");
  }

  const result = await createGist(html, options);
  return {
    id: result.id,
    mode: "gist",
    rawUrl: result.rawUrl,
    name: result.name,
    memo: result.memo,
    trust: result.trust,
  };
}

export async function getTool(id: string): Promise<ToolDetail> {
  if (isCacheId(id)) {
    const entry = await getCacheEntry(id);
    if (!entry) {
      throw new Error("Tool not found");
    }
    return {
      id: entry.id,
      mode: "cache",
      html: entry.html,
      name: entry.name,
      memo: entry.memo,
      trust: entry.trust,
    };
  }

  if (!gistAvailable()) {
    throw new Error("Tool not found");
  }

  const gist = await getGist(id);
  return {
    id: gist.id,
    mode: "gist",
    html: gist.html,
    rawUrl: gist.rawUrl,
    htmlUrl: gist.htmlUrl,
    name: gist.name,
    memo: gist.memo,
    trust: gist.trust,
  };
}

export async function updateTool(
  id: string,
  html: string,
  options?: ToolMeta
): Promise<UpdateResult> {
  if (isCacheId(id)) {
    const result = await updateCacheEntry(id, html, options);
    if (!result) {
      throw new Error("Tool not found");
    }
    return {
      id: result.id,
      mode: "cache",
      name: result.name,
      memo: result.memo,
      trust: result.trust,
    };
  }

  if (!gistAvailable()) {
    throw new Error("Tool not found");
  }

  const result = await updateGist(id, html, options);
  return {
    id: result.id,
    mode: "gist",
    rawUrl: result.rawUrl,
    name: result.name,
    memo: result.memo,
    trust: result.trust,
  };
}

export interface MergedToolSummary extends ToolSummary {
  mode: StorageMode;
}

export async function listRecentTools(
  limit: number,
  baseUrl: string
): Promise<MergedToolSummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);

  const [gistResults, cacheResults] = await Promise.all([
    gistAvailable()
      ? listRecentGists(safeLimit, baseUrl).catch(() => [])
      : Promise.resolve([] as ToolSummary[]),
    isCacheEnabled() || !gistAvailable()
      ? listRecentCacheEntries(safeLimit, baseUrl).catch(() => [])
      : Promise.resolve([]),
  ]);

  const merged: MergedToolSummary[] = [
    ...gistResults.map((t) => ({ ...t, mode: "gist" as const })),
    ...cacheResults.map((t) => ({ ...t, mode: "cache" as const })),
  ];

  merged.sort((a, b) => {
    const ta = new Date(a.updatedAt).getTime();
    const tb = new Date(b.updatedAt).getTime();
    return tb - ta;
  });

  return merged.slice(0, safeLimit);
}
