const GITHUB_API = "https://api.github.com";

interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, { filename: string; raw_url: string; content: string }>;
}

function insertMemoMeta(html: string, memo: string): string {
  const metaTag = `<meta name="tool-memo" content="${memo.replace(/"/g, "&quot;")}">`;

  // <head>タグがある場合はその直後に挿入
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n  ${metaTag}`);
  }

  // <html>タグがある場合は<head>を作成して挿入
  if (html.includes("<html>")) {
    return html.replace("<html>", `<html>\n<head>\n  ${metaTag}\n</head>`);
  }

  // どちらもない場合は先頭に挿入
  return `${metaTag}\n${html}`;
}

function buildDescription(memo?: string): string {
  if (memo) {
    return `HTML Tool - ${memo}`;
  }
  return "HTML Tool";
}

export async function createGist(
  html: string,
  memo?: string
): Promise<{
  id: string;
  rawUrl: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const content = memo ? insertMemoMeta(html, memo) : html;
  const description = buildDescription(memo);

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
  memo?: string
): Promise<{
  id: string;
  rawUrl: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const content = memo ? insertMemoMeta(html, memo) : html;
  const description = buildDescription(memo);

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
