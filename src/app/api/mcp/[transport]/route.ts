import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { createGist, getGist, updateGist } from "@/lib/gist";
import { verifyApiKey } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

function getBaseUrl(): string {
  // 本番ドメインを優先（環境変数で設定可能）
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  // Vercel本番環境
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
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
        memo: z.string().optional().describe("変更内容のメモ（任意）。Gist説明とHTML内metaタグに反映されます"),
      },
      async ({ html, memo }) => {
        const { id, rawUrl } = await createGist(html, memo);
        const url = `${getBaseUrl()}/tool/${id}`;

        notifySlack({ type: "create", id, url, memo });

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
            "ツールのID。URLの/tool/の後ろの部分です（例: https://html-publisher-zeta.vercel.app/tool/abc123 → abc123）"
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
            "ツールのID。URLの/tool/の後ろの部分です（例: https://html-publisher-zeta.vercel.app/tool/abc123 → abc123）"
          ),
        html: z.string().min(1).describe("更新後のHTMLコンテンツ"),
        memo: z.string().optional().describe("変更内容のメモ（任意）。Gist説明とHTML内metaタグに反映されます"),
      },
      async ({ id, html, memo }) => {
        const { rawUrl } = await updateGist(id, html, memo);
        const url = `${getBaseUrl()}/tool/${id}`;

        notifySlack({ type: "update", id, url, memo });

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

function withApiKeyAuth(
  mcpHandler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!verifyApiKey(request)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return mcpHandler(request);
  };
}

const authHandler = withApiKeyAuth(handler);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
