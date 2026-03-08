const GITHUB_API = "https://api.github.com";

interface GistFile {
  filename: string;
  content: string;
}

interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, { filename: string; raw_url: string; content: string }>;
}

export async function createGist(html: string): Promise<{
  id: string;
  rawUrl: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const response = await fetch(`${GITHUB_API}/gists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: "HTML Tool",
      public: false,
      files: {
        "index.html": {
          content: html,
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
  html: string
): Promise<{
  id: string;
  rawUrl: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const response = await fetch(`${GITHUB_API}/gists/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: {
        "index.html": {
          content: html,
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
