import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { createGist, getGist, updateGist } from "@/lib/gist";

function getBaseUrl(): string {
  // Vercel自動設定の環境変数を優先
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

const handler = createMcpHandler(
  (server) => {
    // ツール作成
    server.tool(
      "create_tool",
      "HTMLコンテンツを新規作成し、公開URLを取得します",
      {
        html: z.string().min(1).describe("公開するHTMLコンテンツ"),
      },
      async ({ html }) => {
        const { id, rawUrl } = await createGist(html);
        const url = `${getBaseUrl()}/tool/${id}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id, url, rawUrl }, null, 2),
            },
          ],
        };
      }
    );

    // ツール取得
    server.tool(
      "get_tool",
      "指定されたIDのツールのHTMLソースを取得します。/tool/{id}のURLからIDを抽出して使用してください",
      {
        id: z
          .string()
          .min(1)
          .describe(
            "ツールのID。URLの/tool/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
          ),
      },
      async ({ id }) => {
        const { html, rawUrl } = await getGist(id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id, html, rawUrl }, null, 2),
            },
          ],
        };
      }
    );

    // ツール更新
    server.tool(
      "update_tool",
      "指定されたIDのツールのHTMLコンテンツを上書き更新します。更新後もURLは変わりません",
      {
        id: z
          .string()
          .min(1)
          .describe(
            "ツールのID。URLの/tool/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
          ),
        html: z.string().min(1).describe("更新後のHTMLコンテンツ"),
      },
      async ({ id, html }) => {
        const { rawUrl } = await updateGist(id, html);
        const url = `${getBaseUrl()}/tool/${id}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id, url, rawUrl }, null, 2),
            },
          ],
        };
      }
    );
  },
  {
    serverInfo: {
      name: "html-publisher",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
