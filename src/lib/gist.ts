import * as prettier from "prettier";

const GITHUB_API = "https://api.github.com";

interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, { filename: string; raw_url: string; content: string }>;
  updated_at: string;
}

interface GistListItem {
  id: string;
  description: string;
  updated_at: string;
  files: Record<string, { filename: string; raw_url: string }>;
}

interface GistOptions {
  name?: string;
  memo?: string;
  trust?: boolean;
}

function extractMetaFromHtml(html: string): { name?: string; memo?: string; trust?: boolean } {
  const nameMatch = html.match(/<meta\s+name="tool-name"\s+content="([^"]*)"/);
  const memoMatch = html.match(/<meta\s+name="tool-memo"\s+content="([^"]*)"/);
  const trustMatch = html.match(/<meta\s+name="tool-trust"\s+content="([^"]*)"/);

  return {
    name: nameMatch ? nameMatch[1].replace(/&quot;/g, '"') : undefined,
    memo: memoMatch ? memoMatch[1].replace(/&quot;/g, '"') : undefined,
    trust: trustMatch ? trustMatch[1] === "true" : undefined,
  };
}

function removeMetaTags(html: string): string {
  return html
    .replace(/<meta\s+name="tool-name"\s+content="[^"]*">\n?\s*/g, "")
    .replace(/<meta\s+name="tool-memo"\s+content="[^"]*">\n?\s*/g, "")
    .replace(/<meta\s+name="tool-trust"\s+content="[^"]*">\n?\s*/g, "");
}

function insertMetaTags(html: string, options: GistOptions): string {
  const tags: string[] = [];

  if (options.name) {
    tags.push(`<meta name="tool-name" content="${options.name.replace(/"/g, "&quot;")}">`);
  }
  if (options.memo) {
    tags.push(`<meta name="tool-memo" content="${options.memo.replace(/"/g, "&quot;")}">`);
  }
  if (options.trust !== undefined) {
    tags.push(`<meta name="tool-trust" content="${options.trust}">`);
  }

  if (tags.length === 0) {
    return html;
  }

  const metaTags = tags.join("\n  ");

  // <head>タグがある場合はその直後に挿入
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n  ${metaTags}`);
  }

  // <html>タグがある場合は<head>を作成して挿入
  if (html.includes("<html>")) {
    return html.replace("<html>", `<html>\n<head>\n  ${metaTags}\n</head>`);
  }

  // どちらもない場合は先頭に挿入
  return `${metaTags}\n${html}`;
}

function buildDescription(options: GistOptions): string {
  const parts: string[] = [];

  if (options.name) {
    parts.push(options.name);
  } else {
    parts.push("HTML Tool");
  }

  if (options.memo) {
    parts.push(options.memo);
  }

  return parts.join(" - ");
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
    // フォーマットに失敗した場合は元のHTMLをそのまま返す
    return html;
  }
}

export async function createGist(
  html: string,
  options?: GistOptions
): Promise<{
  id: string;
  rawUrl: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const opts = options || {};
  const cleanHtml = removeMetaTags(html);
  const withMeta = insertMetaTags(cleanHtml, opts);
  const content = await formatHtml(withMeta);
  const description = buildDescription(opts);

  const response = await fetch(`${GITHUB_API}/gists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description,
      public: false,
      files: {
        "index.html": {
          content,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create gist: ${error}`);
  }

  const data: GistResponse = await response.json();
  const rawUrl = data.files["index.html"].raw_url;

  return {
    id: data.id,
    rawUrl,
    name: opts.name,
    memo: opts.memo,
    trust: opts.trust,
  };
}

export async function getGist(id: string): Promise<{
  id: string;
  html: string;
  rawUrl: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const response = await fetch(`${GITHUB_API}/gists/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Gist not found");
    }
    const error = await response.text();
    throw new Error(`Failed to get gist: ${error}`);
  }

  const data: GistResponse = await response.json();
  const file = data.files["index.html"];

  if (!file) {
    throw new Error("index.html not found in gist");
  }

  // HTMLからメタ情報を抽出
  const meta = extractMetaFromHtml(file.content);

  return {
    id: data.id,
    html: file.content,
    rawUrl: file.raw_url,
    name: meta.name,
    memo: meta.memo,
    trust: meta.trust,
  };
}

export async function updateGist(
  id: string,
  html: string,
  options?: GistOptions
): Promise<{
  id: string;
  rawUrl: string;
  name?: string;
  memo?: string;
  trust?: boolean;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  // 入力HTMLから既存のメタ情報を抽出
  const existingMeta = extractMetaFromHtml(html);
  // 既存のメタタグを除去してからマージ
  const cleanHtml = removeMetaTags(html);

  // 新しいオプションと既存のメタ情報をマージ（新しい値が優先）
  const opts: GistOptions = {
    name: options?.name ?? existingMeta.name,
    memo: options?.memo ?? existingMeta.memo,
    trust: options?.trust ?? existingMeta.trust,
  };

  const withMeta = insertMetaTags(cleanHtml, opts);
  const content = await formatHtml(withMeta);
  const description = buildDescription(opts);

  const response = await fetch(`${GITHUB_API}/gists/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description,
      files: {
        "index.html": {
          content,
        },
      },
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Gist not found");
    }
    const error = await response.text();
    throw new Error(`Failed to update gist: ${error}`);
  }

  const data: GistResponse = await response.json();
  const rawUrl = data.files["index.html"].raw_url;

  return {
    id: data.id,
    rawUrl,
    name: opts.name,
    memo: opts.memo,
    trust: opts.trust,
  };
}

export interface ToolSummary {
  id: string;
  name?: string;
  memo?: string;
  trust?: boolean;
  url: string;
  updatedAt: string;
}

export async function listRecentGists(
  limit: number = 10,
  baseUrl: string = "http://localhost:3000"
): Promise<ToolSummary[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  // 多めに取得してフィルタ（index.htmlを含むGistのみ対象）
  const response = await fetch(`${GITHUB_API}/gists?per_page=30`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list gists: ${error}`);
  }

  const gists: GistListItem[] = await response.json();

  // index.htmlを含むGistのみフィルタ
  const toolGists = gists.filter((g) => g.files["index.html"]);

  // 各GistのHTMLからメタ情報を取得（limit件まで）
  const results: ToolSummary[] = [];

  for (const gist of toolGists.slice(0, limit)) {
    try {
      const detail = await getGist(gist.id);
      const toolPath = detail.trust ? "tool-trust" : "tool";

      results.push({
        id: gist.id,
        name: detail.name,
        memo: detail.memo,
        trust: detail.trust,
        url: `${baseUrl}/${toolPath}/${gist.id}`,
        updatedAt: gist.updated_at,
      });
    } catch {
      // 取得に失敗したGistはスキップ
    }
  }

  return results;
}
