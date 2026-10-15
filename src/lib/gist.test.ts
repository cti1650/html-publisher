// Gist 保存時のメタタグ処理のテスト。
// name / memo / trust は HTML 内の <meta> にだけ保存されるため、
// 「挿入 → 整形 → 読み出し → 更新」を繰り返しても値が壊れず、タグが重複しないことを固定する。

import * as prettier from "prettier";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDescription,
  createGist,
  extractMetaFromHtml,
  getGist,
  insertMetaTags,
  removeMetaTags,
  updateGist,
} from "./gist";
import { clearServiceEnv } from "./test-env";

const BASE_HTML = "<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>";

// Gist に保存される形（gist.ts の formatHtml と同じ設定）
function formatLikeGist(html: string): Promise<string> {
  return prettier.format(html, { parser: "html", printWidth: 120, tabWidth: 2, useTabs: false });
}

function countMeta(html: string, name: string): number {
  return html.match(new RegExp(`name="tool-${name}"`, "g"))?.length ?? 0;
}

describe("insertMetaTags", () => {
  it("<head> の直後に挿入する", () => {
    const html = insertMetaTags(BASE_HTML, { name: "N" });
    expect(html).toContain('<head>\n  <meta name="tool-name" content="N">');
  });

  it("<head> が無く <html> がある場合は <head> を作って挿入する", () => {
    const html = insertMetaTags("<html><body>x</body></html>", { memo: "M" });
    expect(html).toMatch(/^<html>\n<head>\n {2}<meta name="tool-memo" content="M">\n<\/head>/);
  });

  it("どちらも無い場合は先頭に挿入する", () => {
    expect(insertMetaTags("<p>x</p>", { trust: true })).toBe('<meta name="tool-trust" content="true">\n<p>x</p>');
  });

  it("オプションが空なら変更しない", () => {
    expect(insertMetaTags(BASE_HTML, {})).toBe(BASE_HTML);
  });

  it("trust: false も明示的に保存する", () => {
    expect(insertMetaTags(BASE_HTML, { trust: false })).toContain('content="false"');
  });

  it("ダブルクォートをエスケープする", () => {
    expect(insertMetaTags(BASE_HTML, { name: 'say "hi"' })).toContain('content="say &quot;hi&quot;"');
  });
});

describe("extractMetaFromHtml", () => {
  it("挿入したメタ情報を同じ値で読み出せる", () => {
    const html = insertMetaTags(BASE_HTML, { name: 'say "hi"', memo: "メモ", trust: true });
    expect(extractMetaFromHtml(html)).toEqual({ name: 'say "hi"', memo: "メモ", trust: true });
  });

  it("Prettier で整形された <meta ... /> からも読み出せる", async () => {
    const html = await formatLikeGist(insertMetaTags(BASE_HTML, { name: "N", trust: false }));
    expect(html).toContain('<meta name="tool-name" content="N" />');
    expect(extractMetaFromHtml(html)).toEqual({ name: "N", memo: undefined, trust: false });
  });

  it("メタタグが無ければすべて undefined", () => {
    expect(extractMetaFromHtml(BASE_HTML)).toEqual({ name: undefined, memo: undefined, trust: undefined });
  });
});

describe("removeMetaTags", () => {
  it("挿入直後の形式を除去する", () => {
    const html = insertMetaTags(BASE_HTML, { name: "N", memo: "M", trust: true });
    expect(removeMetaTags(html)).not.toMatch(/tool-(name|memo|trust)/);
  });

  it("Prettier で整形された <meta ... /> 形式も除去する", async () => {
    const html = await formatLikeGist(insertMetaTags(BASE_HTML, { name: "N", memo: "M", trust: true }));
    expect(removeMetaTags(html)).not.toMatch(/tool-(name|memo|trust)/);
  });

  it("無関係な meta タグは残す", () => {
    const html = '<head><meta charset="utf-8"><meta name="tool-name" content="N"></head>';
    expect(removeMetaTags(html)).toBe('<head><meta charset="utf-8"></head>');
  });
});

describe("buildDescription", () => {
  it.each([
    [{}, "HTML Tool"],
    [{ name: "N" }, "N"],
    [{ memo: "M" }, "HTML Tool - M"],
    [{ name: "N", memo: "M" }, "N - M"],
  ])("%j → %s", (options, expected) => {
    expect(buildDescription(options)).toBe(expected);
  });
});

describe("Gist API との連携", () => {
  const GIST_ID = "0123456789abcdef0123456789abcdef";
  let requests: { url: string; method: string; body?: { description?: string; files: { "index.html": { content: string } } } }[];

  function gistResponse(content: string) {
    return {
      id: GIST_ID,
      html_url: `https://gist.github.com/user/${GIST_ID}`,
      updated_at: "2026-01-01T00:00:00Z",
      files: { "index.html": { filename: "index.html", raw_url: "https://gist.githubusercontent.com/raw", content } },
    };
  }

  beforeEach(() => {
    clearServiceEnv();
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        requests.push({ url, method: init?.method ?? "GET", body });
        return new Response(JSON.stringify(gistResponse(body?.files["index.html"].content ?? "")), { status: 200 });
      })
    );
  });

  it("createGist はメタタグを挿入・整形して非公開Gistとして作成する", async () => {
    const result = await createGist(BASE_HTML, { name: "N", memo: "M" });
    expect(result).toMatchObject({ id: GIST_ID, name: "N", memo: "M" });
    expect(requests[0].method).toBe("POST");
    expect(requests[0].body?.description).toBe("N - M");
    const content = requests[0].body!.files["index.html"].content;
    expect(extractMetaFromHtml(content)).toMatchObject({ name: "N", memo: "M" });
  });

  it("updateGist を繰り返してもメタタグが重複しない", async () => {
    // 1回目: 作成（Gist 上は Prettier 整形済みの <meta ... /> 形式で保存される）
    await createGist(BASE_HTML, { name: "N", trust: true });
    let stored = requests.at(-1)!.body!.files["index.html"].content;

    // 2〜3回目: 保存済みHTMLをそのまま渡して更新（get_tool → update_tool の流れ）
    for (const memo of ["v2", "v3"]) {
      await updateGist(GIST_ID, stored, { memo });
      stored = requests.at(-1)!.body!.files["index.html"].content;
    }

    expect(countMeta(stored, "name")).toBe(1);
    expect(countMeta(stored, "memo")).toBe(1);
    expect(countMeta(stored, "trust")).toBe(1);
    expect(extractMetaFromHtml(stored)).toEqual({ name: "N", memo: "v3", trust: true });
    expect(requests.at(-1)!.body?.description).toBe("N - v3");
  });

  it("updateGist は未指定の項目に既存の値を引き継ぎ、指定した項目は上書きする", async () => {
    const existing = await formatLikeGist(insertMetaTags(BASE_HTML, { name: "old", memo: "keep", trust: true }));
    const result = await updateGist(GIST_ID, existing, { name: "new", trust: false });
    expect(result).toMatchObject({ name: "new", memo: "keep", trust: false });
  });

  it("getGist は 404 を Gist not found に変換する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(getGist(GIST_ID)).rejects.toThrow("Gist not found");
  });

  it("GITHUB_TOKEN が無ければ通信せずにエラーにする", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    await expect(createGist(BASE_HTML)).rejects.toThrow("GITHUB_TOKEN is not set");
    expect(requests).toHaveLength(0);
  });
});
