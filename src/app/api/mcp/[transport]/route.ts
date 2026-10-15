import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getGist, addMetadata } from "@/lib/gist";
import { createTool, getTool, updateTool, listRecentTools } from "@/lib/storage";
import { isCacheId } from "@/lib/cache";
import { checkAuth, authContext, getAuthCapabilities, type AuthCapabilities } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";
import { HOW_TO_USE_GUIDE } from "@/lib/guide";
import { scanHtml } from "@/lib/security";
import { evaluateSecurityGate } from "@/lib/security/gate";
import { TEMPLATES, TEMPLATE_IDS, getTemplateInfo, loadTemplateHtml } from "@/lib/templates";
import {
  checkCreateInput,
  checkImportGistPermission,
  checkTrustConfirmation,
  checkUpdateInput,
  checkUpdatePermission,
  resolveEphemeral,
  toolPath,
} from "@/lib/policy";
import { EditError, applyEdits, type EditChange, type HtmlEdit } from "@/lib/edits";
import { removeMetaTags } from "@/lib/gist";

function renderStatusBlock(cap: AuthCapabilities): string {
  const yes = "可";
  const no = "不可";
  const lines = [
    "## 現在の接続状態",
    "",
    `**${cap.label}** — ${cap.summary}`,
    "",
    "### このセッションで利用可能な操作",
    `- 永続モード（Gist）の作成: ${cap.canCreatePersistent ? yes : no}`,
    `- 永続モード（Gist）の更新: ${cap.canUpdatePersistent ? yes : no}`,
    `- 揮発モード（Cache）の作成/更新: ${cap.canCreateEphemeral ? yes : no}`,
    `- import_gist: ${cap.canImportGist ? yes : no}`,
  ];
  if (cap.forcedEphemeral) {
    lines.push(
      "",
      "> **重要**: `create_tool` は `ephemeral` 指定に関わらず**揮発モードに強制**されます。ユーザーに「永続/揮発どちらにしますか？」と尋ねる前に、この制約を伝えてください。"
    );
  }
  return lines.join("\n");
}

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

function errorResult(error: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error }, null, 2) }] };
}

function currentAuthStatus() {
  return authContext.getStore()?.status ?? "anonymous";
}

const editsSchema = z
  .array(
    z.object({
      old_text: z
        .string()
        .min(1)
        .describe(
          "置き換え前の文字列。get_tool で取得した保存済みHTMLから、空白・改行・インデントを含めて正確に写す。HTML内でちょうど1か所に一致する必要がある（複数に一致する場合は前後の文脈を含めて一意にする）"
        ),
      new_text: z.string().describe("置き換え後の文字列（空文字で削除）"),
    })
  )
  .min(1)
  .max(50);

/**
 * 保存済みツールの HTML に edits を適用する。
 * 失敗した場合は MCP のエラー応答を返す（何も保存しない）。
 */
async function applyEditsToTool(
  id: string,
  edits: HtmlEdit[],
  label: string
): Promise<{ html: string; changes: EditChange[] } | { error: ReturnType<typeof errorResult> }> {
  let source: string;
  try {
    source = (await getTool(id)).html;
  } catch (error) {
    if (error instanceof Error && (error.message === "Tool not found" || error.message === "Gist not found")) {
      return { error: errorResult(`${label} のツールが見つかりません: ${id}`) };
    }
    throw error;
  }
  try {
    return applyEdits(source, edits);
  } catch (error) {
    if (error instanceof EditError) return { error: errorResult(error.message) };
    throw error;
  }
}

const handler = createMcpHandler(
  (server) => {
    // 使い方ガイド
    server.registerTool(
      "how_to_use",
      {
        title: "How to use HTML Publisher",
        description:
          "【重要・最初に呼び出してください】HTML Publisherの推奨ワークフロー、各MCPツールの使い分け、trust/confirm_trust等のフラグの判断基準を返します。冒頭に現在の認証状態（永続モード利用可否）も含まれるので、create_tool/update_tool等を初めて使う前に必ず呼び出してください。新しくHTML公開機能を実装する必要はなく、提供されているMCPツールを使うだけで完結します",
        inputSchema: {},
      },
      async () => {
        const status = currentAuthStatus();
        const cap = getAuthCapabilities(status);
        const statusBlock = renderStatusBlock(cap);
        return {
          content: [
            {
              type: "text",
              text: `${statusBlock}\n\n${HOW_TO_USE_GUIDE}`,
            },
          ],
        };
      }
    );

    // 現在の認証状態と利用可能な操作を取得
    server.registerTool(
      "get_status",
      {
        title: "Get Current Status",
        description:
          "現在の認証状態（認証済み/匿名）と、このセッションで利用可能な操作（永続モード作成/更新可否、import_gist可否、揮発モード強制の有無）を構造化データで返します。create_tool等を呼ぶ前にこのツールで状態を確認すれば、永続モードを提案できるかどうか判断できます",
        inputSchema: {},
      },
      async () => {
        const status = currentAuthStatus();
        const cap = getAuthCapabilities(status);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(cap, null, 2),
            },
          ],
        };
      }
    );

    // 実装サンプル（テンプレート）一覧
    server.registerTool(
      "list_templates",
      {
        title: "List Templates",
        description:
          "【HTMLを書き始める前に確認を推奨】HTML Publisher で動作確認済みの実装サンプル（テンプレート）一覧を返します。シンプルなWebアプリ、スライド（Reveal.js + PDF保存 + 全画面）、Tampermonkey用UserScript/ブックマークレットの導入支援ページ、Chrome拡張機能のZIP生成ページがあります。依頼内容が useWhen に合うものがあれば get_template で本体を取得し、editPoints の箇所を書き換えて create_tool に渡してください。各テンプレートの trustRequired は security_check の判定と一致しています",
        inputSchema: {},
      },
      async () => {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(TEMPLATES, null, 2),
            },
          ],
        };
      }
    );

    // 実装サンプル（テンプレート）取得
    server.registerTool(
      "get_template",
      {
        title: "Get Template",
        description:
          "list_templates で選んだテンプレートのHTML本体と、書き換える箇所（editPoints）・trust の要否を返します。マーカー（*:START 〜 *:END）で囲まれた範囲を依頼内容に合わせて書き換え、それ以外の部分（コピー・ダウンロード・PDF保存などの共通処理）は原則そのまま使ってください",
        inputSchema: {
          id: z.enum(TEMPLATE_IDS).describe("テンプレートID（list_templates の id）"),
        },
      },
      async ({ id }) => {
        const info = getTemplateInfo(id);
        const html = await loadTemplateHtml(id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...info, html }, null, 2),
            },
          ],
        };
      }
    );

    // 公開前HTML静的解析。このツール単体は公開をブロックしない（create_tool 側で HIGH を止める）
    server.registerTool(
      "security_check",
      {
        title: "Security Check",
        description:
          "【create_tool / update_tool の前に実行を推奨】公開予定のHTMLを静的解析し、そのHTMLが「何を要求し、どこと通信するのか」を可視化します。返却値の risk / findings / capabilities / externalDomains を確認し、HIGH・MEDIUMがあればユーザーに内容を説明してください。このツール単体は公開をブロックしませんが、create_tool / update_tool では同じ解析が自動で走り、HIGHがあると confirm_security: true が無い限り失敗します。また脆弱性の完全判定を行うものではなく、検出0件でも安全の保証にはなりません（limitations に検出できない範囲を明記しています）",
        inputSchema: {
          html: z.string().min(1).describe("解析するHTMLコンテンツ（create_tool に渡す予定のもの）"),
        },
      },
      async ({ html }) => {
        const report = scanHtml(html, { selfOrigin: getBaseUrl() });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
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
          "【実行前に必ずユーザーに確認を取ること】HTMLコンテンツを新規作成し、公開URLを取得します。**公開前チェックが自動で走り、HIGHが検出された場合は confirm_security: true が無いと失敗します**（HIGHが無ければ従来どおり指定不要）。実行前に「どのようなHTMLを作成するか」「name/memoの内容」「trustモードの有無」「ephemeralモードの有無」をユーザーに説明し、作成してよいか確認を取ってください。**既存ツールに似たツールを作る場合は html の代わりに base_id + edits を使うと、変更箇所だけを送って新しいツールを作成できます**（元のツールは変更されず、trust は引き継がれません。応答の changes に書き換え箇所の行番号と差分が入ります）。ephemeral: trueにするとGistを使わず揮発キャッシュ（デフォルト6時間、アクセス毎にTTL延長）に保存されます。**APIキー無しの匿名アクセス時は強制的に揮発モードになります（Gist書き込みは認証必須）**",
        inputSchema: {
          html: z
            .string()
            .min(1)
            .optional()
            .describe("公開するHTMLコンテンツ（全文）。base_id + edits を使う場合は指定しない"),
          base_id: z
            .string()
            .min(1)
            .optional()
            .describe(
              "元にする既存ツールのID。edits と組み合わせて、そのHTMLを書き換えた新しいツールを作成する（元のツールは変更しない）。trust は引き継がない"
            ),
          edits: editsSchema
            .optional()
            .describe(
              "base_id のHTMLに対する書き換え内容。すべて元のHTMLに対して照合され、1つでも一致しない・複数に一致する・範囲が重なる場合は何も作成しない"
            ),
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
          confirm_security: z
            .boolean()
            .optional()
            .describe(
              "公開前チェックでHIGHが検出された場合のみ必要。内容をユーザーに説明し承認を得たうえで true を指定してください。HIGHが無い場合は指定不要です"
            ),
          ephemeral: z
            .boolean()
            .optional()
            .describe(
              "揮発モード。trueにするとGistではなくキャッシュに保存され、最後のアクセスから一定時間（デフォルト6時間）で自動削除されます。ハッカソンや一時共有用途に推奨。GITHUB_TOKEN未設定環境では自動的に揮発モードになります"
            ),
        },
      },
      async ({ html: inputHtml, base_id, edits, name, memo, trust, confirm_trust, confirm_security, ephemeral }) => {
        const inputCheck = checkCreateInput({ html: inputHtml, base_id, edits });
        if (!inputCheck.ok) return errorResult(inputCheck.error);
        const trustCheck = checkTrustConfirmation(trust, confirm_trust);
        if (!trustCheck.ok) return errorResult(trustCheck.error);

        let html: string;
        let changes: EditChange[] | undefined;
        if (base_id !== undefined && edits !== undefined) {
          const edited = await applyEditsToTool(base_id, edits, "base_id");
          if ("error" in edited) return edited.error;
          // 元ツールの name / memo / trust のメタタグは引き継がない
          html = removeMetaTags(edited.html);
          changes = edited.changes;
        } else {
          html = inputHtml!;
        }

        // 公開前チェック。HIGH がある場合のみ confirm_security を要求する
        const gate = evaluateSecurityGate(html, {
          selfOrigin: getBaseUrl(),
          confirmed: confirm_security,
        });
        if (gate.blocked) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: gate.message, security: gate.summary, changes }, null, 2),
              },
            ],
          };
        }

        const finalEphemeral = resolveEphemeral(currentAuthStatus(), ephemeral);

        const result = await createTool(html, { name, memo, trust, ephemeral: finalEphemeral });
        const url = `${getBaseUrl()}/${toolPath(result.trust)}/${result.id}`;

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
                {
                  id: result.id,
                  url,
                  rawUrl: result.rawUrl,
                  trust: result.trust,
                  mode: result.mode,
                  base: base_id !== undefined ? { id: base_id } : undefined,
                  changes,
                  security: gate.summary,
                },
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
        const url = `${getBaseUrl()}/${toolPath(result.trust)}/${id}`;

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
          "【実行前に必ずユーザーに確認を取ること】【html（全文）か edits（差分）のどちらか一方が必須】HTMLコンテンツを上書き更新します。**一部だけ変える場合は edits を使うと、全文を送り直さずに済みます**（old_text は get_tool で取得した保存済みHTMLから写すこと。応答の changes に書き換え箇所の行番号と差分が入るので、意図した箇所かを確認すること）。**公開前チェックが自動で走り、HIGHが検出された場合は confirm_security: true が無いと失敗します**（HIGHが無ければ従来どおり指定不要）。実行前に「どのような変更を行うか」「変更箇所の概要」をユーザーに説明し、更新してよいか確認を取ってください。メタデータ（name/memo/trust）のみ変更したい場合はimport_gistを使用してください。揮発モード・永続モードの判別はIDで自動的に行われます。**APIキー無しの匿名アクセス時は揮発モードのIDのみ更新可能（永続Gistの更新は認証必須）**",
        inputSchema: {
          id: z
            .string()
            .min(1)
            .describe(
              "ツールのID。URLの/tool/または/tool-trust/の後ろの部分です（例: https://example.com/tool/abc123 → abc123）"
            ),
          html: z
            .string()
            .min(1)
            .optional()
            .describe("更新後のHTMLコンテンツ（全文）。edits を使う場合は指定しない"),
          edits: editsSchema
            .optional()
            .describe(
              "保存済みHTMLに対する書き換え内容（差分更新）。すべて元のHTMLに対して照合され、1つでも一致しない・複数に一致する・範囲が重なる場合は何も更新しない"
            ),
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
          confirm_security: z
            .boolean()
            .optional()
            .describe(
              "公開前チェックでHIGHが検出された場合のみ必要。内容をユーザーに説明し承認を得たうえで true を指定してください。HIGHが無い場合は指定不要です"
            ),
        },
      },
      async ({ id, html: inputHtml, edits, name, memo, trust, confirm_trust, confirm_security }) => {
        const inputCheck = checkUpdateInput({ html: inputHtml, edits });
        if (!inputCheck.ok) return errorResult(inputCheck.error);
        const trustCheck = checkTrustConfirmation(trust, confirm_trust);
        if (!trustCheck.ok) return errorResult(trustCheck.error);
        const updateCheck = checkUpdatePermission(currentAuthStatus(), id);
        if (!updateCheck.ok) return errorResult(updateCheck.error);

        let html: string;
        let changes: EditChange[] | undefined;
        if (edits !== undefined) {
          const edited = await applyEditsToTool(id, edits, "id");
          if ("error" in edited) return edited.error;
          html = edited.html;
          changes = edited.changes;
        } else {
          html = inputHtml!;
        }

        // 公開前チェック。HIGH がある場合のみ confirm_security を要求する
        const gate = evaluateSecurityGate(html, {
          selfOrigin: getBaseUrl(),
          confirmed: confirm_security,
        });
        if (gate.blocked) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: gate.message, security: gate.summary, changes }, null, 2),
              },
            ],
          };
        }

        const result = await updateTool(id, html, { name, memo, trust });
        const url = `${getBaseUrl()}/${toolPath(result.trust)}/${id}`;

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
                {
                  id,
                  url,
                  rawUrl: result.rawUrl,
                  trust: result.trust,
                  mode: result.mode,
                  changes,
                  security: gate.summary,
                },
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
        const trustCheck = checkTrustConfirmation(trust, confirm_trust);
        if (!trustCheck.ok) return errorResult(trustCheck.error);
        const importCheck = checkImportGistPermission(currentAuthStatus(), id);
        if (!importCheck.ok) return errorResult(importCheck.error);
        const result = await addMetadata(id, { name, memo, trust });
        const url = `${getBaseUrl()}/${toolPath(result.trust)}/${id}`;

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
        const toolUrl = `${getBaseUrl()}/${toolPath(result.trust)}/${id}`;
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
