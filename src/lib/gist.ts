const GITHUB_API = "https://api.github.com";

interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, { filename: string; raw_url: string; content: string }>;
}

interface GistOptions {
  name?: string;
  memo?: string;
}

function insertMetaTags(html: string, options: GistOptions): string {
  const tags: string[] = [];

  if (options.name) {
    tags.push(`<meta name="tool-name" content="${options.name.replace(/"/g, "&quot;")}">`);
  }
  if (options.memo) {
    tags.push(`<meta name="tool-memo" content="${options.memo.replace(/"/g, "&quot;")}">`);
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

export async function createGist(
  html: string,
  options?: GistOptions
): Promise<{
  id: string;
  rawUrl: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const opts = options || {};
  const content = insertMetaTags(html, opts);
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
  };
}

export async function getGist(id: string): Promise<{
  id: string;
  html: string;
  rawUrl: string;
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

  return {
    id: data.id,
    html: file.content,
    rawUrl: file.raw_url,
  };
}

export async function updateGist(
  id: string,
  html: string,
  options?: GistOptions
): Promise<{
  id: string;
  rawUrl: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const opts = options || {};
  const content = insertMetaTags(html, opts);
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
  };
}
