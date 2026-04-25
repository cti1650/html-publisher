import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getGist, addMetadata } from "@/lib/gist";
import { createTool, getTool, updateTool, listRecentTools } from "@/lib/storage";
import { isCacheId } from "@/lib/cache";
import { checkAuth, authContext } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";
import { HOW_TO_USE_GUIDE } from "@/lib/guide";

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
    // 使い方ガイド
    server.registerTool(
      "how_to_use",
      {
        title: "How to use HTML Publisher",
        description:
          "【重要・最初に呼び出してください】HTML Publisherの推奨ワークフロー、各MCPツールの使い分け、trust/confirm_trust等のフラグの判断基準を返します。create_tool/update_tool等を初めて使う前にこのツールを呼び出して使い方を確認してください。新しくHTML公開機能を実装する必要はなく、提供されているMCPツールを使うだけで完結します",
        inputSchema: {},
      },
      async () => {
        return {
          content: [
            {
              type: "text",
              text: HOW_TO_USE_GUIDE,
            },
          ],
        };
      }
    );

    // ツール作成
    server.registerTool(
      "create_tool",
      {
        title: "Create Tool",
        description:
          "【実行前に必ずユーザーに確認を取ること】HTMLコンテンツを新規作成し、公開URLを取得します。実行前に「どのようなHTMLを作成するか」「name/memoの内容」「trustモードの有無」「ephemeralモードの有無」をユーザーに説明し、作成してよいか確認を取ってください。ephemeral: trueにするとGistを使わず揮発キャッシュ（デフォルト6時間、アクセス毎にTTL延長）に保存されます。**APIキー無しの匿名アクセス時は強制的に揮発モードになります（Gist書き込みは認証必須）**",
        inputSchema: {
          html: z.string().min(1).describe("公開するHTMLコンテンツ"),
          name: z.string().optional().describe("ツール名（任意）。Gist説明とHTML内metaタグに反映されます"),
          memo: z.string().optional().describe("変更内容のメモ（任意）。Gist説明とHTML内metaタグに反映されます"),
          trust: z
            .boolean()
            .optional()
            .describe(
              "【危険】信頼モード。trueにするとiframe sandboxが無効化され、HTMLがページ内で直接実行されます。カメラ/マイク等のAPI利用が必要な場合のみ使用してください"
            ),
          confirm_trust: z
            .boolean()
            .optional()
            .describe("trust: trueを指定する場合は必ずconfirm_trust: trueも指定してください。ユーザーに確認を取ってから有効化することを推奨します"),
          ephemeral: z
            .boolean()
            .optional()
            .describe(
              "揮発モード。trueにするとGistではなくキャッシュに保存され、最後のアクセスから一定時間（デフォルト6時間）で自動削除されます。ハッカソンや一時共有用途に推奨。GITHUB_TOKEN未設定環境では自動的に揮発モードになります"
            ),
        },
      },
      async ({ html, name, memo, trust, confirm_trust, ephemeral }) => {
        if (trust && !confirm_trust) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "trust: trueを指定する場合はconfirm_trust: trueも必要です。信頼モードはセキュリティ制限が無効化されます。ユーザーに確認を取ってから再実行してください。",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        // 匿名アクセスは揮発モード固定（永続モード=Gist書き込みは認証必須）
        const authenticated = authContext.getStore()?.status === "authenticated";
        const finalEphemeral = !authenticated ? true : ephemeral;

        const result = await createTool(html, { name, memo, trust, ephemeral: finalEphemeral });
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${result.id}`;

        await notifySlack({
          type: "create",
          id: result.id,
          url,
          name: result.name,
          memo: result.memo,
          trust: result.trust,
          mode: result.mode,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id: result.id, url, rawUrl: result.rawUrl, trust: result.trust, mode: result.mode },
                null,
                2
              ),
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
        description:
          "指定されたIDのツールのHTMLソースを取得します。/tool/{id}または/tool-trust/{id}のURLからIDを抽出して使用してください。揮発モード（c_で始まるID）でも永続モードでも透過的に動作します",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
            ),
        },
      },
      async ({ id }) => {
        const result = await getTool(id);
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${id}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id, html: result.html, rawUrl: result.rawUrl, url, trust: result.trust, mode: result.mode },
                null,
                2
              ),
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
        description:
          "【実行前に必ずユーザーに確認を取ること】【htmlパラメータ必須】HTMLコンテンツを上書き更新します。実行前に「どのような変更を行うか」「変更箇所の概要」をユーザーに説明し、更新してよいか確認を取ってください。メタデータ（name/memo/trust）のみ変更したい場合はimport_gistを使用してください。揮発モード・永続モードの判別はIDで自動的に行われます。**APIキー無しの匿名アクセス時は揮発モードのIDのみ更新可能（永続Gistの更新は認証必須）**",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
            ),
          html: z.string().min(1).describe("更新後のHTMLコンテンツ"),
          name: z.string().optional().describe("ツール名（任意）。Gist説明とHTML内metaタグに反映されます"),
          memo: z.string().optional().describe("変更内容のメモ（任意）。Gist説明とHTML内metaタグに反映されます"),
          trust: z
            .boolean()
            .optional()
            .describe(
              "【危険】信頼モード。trueにするとiframe sandboxが無効化され、HTMLがページ内で直接実行されます。カメラ/マイク等のAPI利用が必要な場合のみ使用してください"
            ),
          confirm_trust: z
            .boolean()
            .optional()
            .describe("trust: trueを指定する場合は必ずconfirm_trust: trueも指定してください。ユーザーに確認を取ってから有効化することを推奨します"),
        },
      },
      async ({ id, html, name, memo, trust, confirm_trust }) => {
        if (trust && !confirm_trust) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "trust: trueを指定する場合はconfirm_trust: trueも必要です。信頼モードはセキュリティ制限が無効化されます。ユーザーに確認を取ってから再実行してください。",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        // 永続モード（Gist）の更新は認証必須。匿名は揮発モードのみ更新可
        const authenticated = authContext.getStore()?.status === "authenticated";
        if (!authenticated && !isCacheId(id)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "永続モード（Gist）の更新には認証が必要です。揮発モード（c_で始まるID）のみ匿名で更新可能です",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await updateTool(id, html, { name, memo, trust });
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${id}`;

        await notifySlack({
          type: "update",
          id,
          url,
          name: result.name,
          memo: result.memo,
          trust: result.trust,
          mode: result.mode,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id, url, rawUrl: result.rawUrl, trust: result.trust, mode: result.mode },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // 既存Gistの取り込み（Gist専用）
    server.registerTool(
      "import_gist",
      {
        title: "Import Gist",
        description:
          "【実行前に必ずユーザーに確認を取ること】【HTMLを変更せずにメタデータのみ追加】手動で作成したGistをHTML Publisherの管理対象に取り込みます。実行前に「対象のGist ID」「設定するメタデータ」をユーザーに説明し、取り込んでよいか確認を取ってください。HTMLの中身は一切変更しません。揮発モード（c_で始まるID）には使えません。**APIキー認証必須（匿名アクセス不可）**",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "GistのID。GitHubのGist URLの末尾部分です（例: https://gist.github.com/user/abc123 → abc123）"
            ),
          name: z.string().optional().describe("ツール名（任意）"),
          memo: z.string().optional().describe("メモ（任意）"),
          trust: z
            .boolean()
            .optional()
            .describe(
              "【危険】信頼モード。trueにするとiframe sandboxが無効化され、HTMLがページ内で直接実行されます。カメラ/マイク等のAPI利用が必要な場合のみ使用してください"
            ),
          confirm_trust: z
            .boolean()
            .optional()
            .describe("trust: trueを指定する場合は必ずconfirm_trust: trueも指定してください。ユーザーに確認を取ってから有効化することを推奨します"),
        },
      },
      async ({ id, name, memo, trust, confirm_trust }) => {
        if (trust && !confirm_trust) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "trust: trueを指定する場合はconfirm_trust: trueも必要です。信頼モードはセキュリティ制限が無効化されます。ユーザーに確認を取ってから再実行してください。",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        if (isCacheId(id)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { error: "import_gistは揮発モード（c_で始まるID）には使用できません。Gist IDを指定してください" },
                  null,
                  2
                ),
              },
            ],
          };
        }
        // import_gist は Gist 書き込みを伴うため認証必須
        const authenticated = authContext.getStore()?.status === "authenticated";
        if (!authenticated) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { error: "import_gistの実行には認証が必要です。APIキーを設定してください" },
                  null,
                  2
                ),
              },
            ],
          };
        }
        const result = await addMetadata(id, { name, memo, trust });
        const toolPath = result.trust ? "tool-trust" : "tool";
        const url = `${getBaseUrl()}/${toolPath}/${id}`;

        await notifySlack({
          type: "update",
          id,
          url,
          name: result.name,
          memo: result.memo,
          trust: result.trust,
          mode: "gist",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id, url, rawUrl: result.rawUrl, name: result.name, memo: result.memo, trust: result.trust },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Gist編集URL取得（Gist専用）
    server.registerTool(
      "get_gist_url",
      {
        title: "Get Gist URL",
        description: "指定されたIDのツールのGitHub Gist編集ページURLを取得します。揮発モード（c_で始まるID）にはGistが存在しないためエラーになります",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
            ),
        },
      },
      async ({ id }) => {
        if (isCacheId(id)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { error: "揮発モードのツールにはGistがありません。Gist編集ページは取得できません" },
                  null,
                  2
                ),
              },
            ],
          };
        }
        const result = await getGist(id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id, gistUrl: result.htmlUrl }, null, 2),
            },
          ],
        };
      }
    );

    // ツール一覧取得
    server.registerTool(
      "list_recent_tools",
      {
        title: "List Recent Tools",
        description:
          "直近で作成・更新されたツールの一覧を取得します（最大10件、永続モードのみ）。HTMLソースは含まれません。揮発モード（c_で始まるID）はプライバシー保護のため一覧に含まれません。揮発モードのツールは作成時に返されるURL/IDを記録し、共有相手にだけ伝える運用としてください",
        inputSchema: {
          limit: z.number().min(1).max(10).optional().describe("取得件数（1-10、デフォルト10）"),
        },
      },
      async ({ limit }) => {
        const tools = await listRecentTools(limit ?? 10, getBaseUrl());

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(tools, null, 2),
            },
          ],
        };
      }
    );

    // QRコードURL取得
    server.registerTool(
      "get_qr_code",
      {
        title: "Get QR Code",
        description:
          "【QRコードで共有したい場合はこのツールを使用】ツール共有用のQRコードを中央に表示するページのURLを返します。返されるURLをそのまま共有相手に渡せば、ブラウザでQRコードを表示できます。新しくQRコード生成機能を実装する必要はありません",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
            ),
          size: z.number().min(100).max(500).optional().describe("QRコードのサイズ（ピクセル、100-500、デフォルト300）"),
        },
      },
      async ({ id, size }) => {
        const result = await getTool(id);
        const toolPath = result.trust ? "tool-trust" : "tool";
        const toolUrl = `${getBaseUrl()}/${toolPath}/${id}`;
        const qrSize = size ?? 300;
        const qrPageUrl = `${getBaseUrl()}/qr/${id}?size=${qrSize}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id, toolUrl, qrPageUrl, size: qrSize },
                null,
                2
              ),
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

function withAuth(
  mcpHandler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const status = checkAuth(request);
    if (status === "rejected") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // 認証状態を AsyncLocalStorage で各ツールハンドラーに伝搬
    return authContext.run({ status }, () => mcpHandler(request));
  };
}

const authHandler = withAuth(handler);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
