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
    server.registerTool(
      "create_tool",
      {
        title: "Create Tool",
        description: "HTMLコンテンツを新規作成し、公開URLを取得します",
        inputSchema: {
          html: z.string().min(1).describe("公開するHTMLコンテンツ"),
          name: z.string().optional().describe("ツール名（任意）。Gist説明とHTML内metaタグに反映されます"),
          memo: z.string().optional().describe("変更内容のメモ（任意）。Gist説明とHTML内metaタグに反映されます"),
          trust: z.boolean().optional().describe("信頼モード（任意）。trueの場合はlocalStorage等が使える信頼済みURLを発行します"),
        },
      },
      async ({ html, name, memo, trust }) => {
        const result = await createGist(html, { name, memo, trust });
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${result.id}`;

        notifySlack({ type: "create", id: result.id, url, name: result.name, memo: result.memo, trust: result.trust });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id: result.id, url, rawUrl: result.rawUrl, trust: result.trust }, null, 2),
            },
          ],
        };
      }
    );

    // ツール取得
    server.registerTool(
      "get_tool",
      {
        title: "Get Tool",
        description: "指定されたIDのツールのHTMLソースを取得します。/tool/{id}または/tool-trust/{id}のURLからIDを抽出して使用してください",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://html-publisher-zeta.vercel.app/tool/abc123 → abc123）"
            ),
        },
      },
      async ({ id }) => {
        const result = await getGist(id);
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${id}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id, html: result.html, rawUrl: result.rawUrl, url, trust: result.trust }, null, 2),
            },
          ],
        };
      }
    );

    // ツール更新
    server.registerTool(
      "update_tool",
      {
        title: "Update Tool",
        description: "指定されたIDのツールのHTMLコンテンツを上書き更新します。trustフラグが変わるとURLのパスも変わります",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://html-publisher-zeta.vercel.app/tool/abc123 → abc123）"
            ),
          html: z.string().min(1).describe("更新後のHTMLコンテンツ"),
          name: z.string().optional().describe("ツール名（任意）。Gist説明とHTML内metaタグに反映されます"),
          memo: z.string().optional().describe("変更内容のメモ（任意）。Gist説明とHTML内metaタグに反映されます"),
          trust: z.boolean().optional().describe("信頼モード（任意）。trueの場合はlocalStorage等が使える信頼済みURLを発行します"),
        },
      },
      async ({ id, html, name, memo, trust }) => {
        const result = await updateGist(id, html, { name, memo, trust });
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${id}`;

        // updateGistから返されたname/memo/trustを使用（既存の値がマージされている）
        notifySlack({ type: "update", id, url, name: result.name, memo: result.memo, trust: result.trust });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id, url, rawUrl: result.rawUrl, trust: result.trust }, null, 2),
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
