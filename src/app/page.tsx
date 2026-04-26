export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black font-sans">
      <main className="max-w-3xl mx-auto py-16 px-6">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
          HTML Publisher
        </h1>

        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-8">
          ChatGPTなどで生成した単一HTMLファイルをAPI経由で公開し、URLを取得できます。
          ストレージは <strong>永続モード（GitHub Gist）</strong> と <strong>揮発モード（Cache、自動削除あり）</strong> の2種類。
        </p>

        {/* 認証 */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Authentication
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            APIキーは <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm">?key=...</code> クエリ
            または <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm">x-api-key</code> ヘッダで提示します。
          </p>
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 text-zinc-900 dark:text-zinc-50">状態</th>
                  <th className="text-left py-2 text-zinc-900 dark:text-zinc-50">挙動</th>
                </tr>
              </thead>
              <tbody className="text-zinc-600 dark:text-zinc-400">
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 align-top whitespace-nowrap pr-4">認証済み</td>
                  <td className="py-2">永続/揮発どちらも作成・更新可能</td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 align-top whitespace-nowrap pr-4">匿名（キー未提示）</td>
                  <td className="py-2">
                    <strong>揮発モード強制</strong>。<code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">ephemeral</code> 指定は無視され常に揮発。
                    永続Gistの更新は <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">403</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 align-top whitespace-nowrap pr-4">拒否（キー不正）</td>
                  <td className="py-2">全リクエスト <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">401</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            API Reference
          </h2>

          {/* ツール一覧取得 */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              GET /api/tools
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              直近で作成・更新されたツール一覧を取得します（最大10件）。
              <strong>揮発モード（ID が <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-sm">c_</code> で始まる）はプライバシー保護のため一覧に含まれません。</strong>
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4">
              <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`[
  {
    "id": "abc123...",
    "name": "コンパスアプリ",
    "memo": "方位を表示",
    "trust": true,
    "url": "https://your-domain.com/tool-trust/abc123...",
    "updatedAt": "2024-01-15T12:00:00Z",
    "mode": "gist"
  }
]`}
              </pre>
            </div>
          </div>

          {/* HTML登録 */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              POST /api/tools
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              HTMLを登録し、公開URLを取得します。
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4 overflow-x-auto mb-4">
              <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "html": "<!DOCTYPE html>...",
  "name": "ツール名",      // 任意
  "memo": "変更メモ",      // 任意
  "trust": false,         // 任意: trueでlocalStorage等を許可
  "ephemeral": false      // 任意: trueで揮発モード（Cache、自動削除）
}`}
              </pre>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">Response:</p>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4">
                <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "id": "abc123...",                  // 揮発モードは "c_" プレフィックス
  "url": "https://your-domain.com/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/...",  // 永続のみ
  "trust": false,
  "mode": "gist"                      // "gist" | "cache"
}`}
                </pre>
              </div>
            </div>
          </div>

          {/* ツール取得 */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              GET /api/tools/:id
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              登録済みHTMLの情報を取得します。永続/揮発のID形式から自動判別します。
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4">
              <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "id": "abc123...",
  "html": "<!DOCTYPE html>...",
  "rawUrl": "https://gist.githubusercontent.com/...",  // 永続のみ
  "url": "https://your-domain.com/tool/abc123...",
  "trust": false,
  "mode": "gist"
}`}
              </pre>
            </div>
          </div>

          {/* ツール更新 */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              PUT /api/tools/:id
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              既存ツールのHTMLを上書き更新します。
              <strong>匿名アクセス時は揮発モード（<code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-sm">c_</code> で始まるID）のみ更新可能。</strong>
              永続Gistの更新は 403 で拒否されます。
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4 overflow-x-auto mb-4">
              <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "html": "<!DOCTYPE html>...",
  "name": "ツール名",      // 任意
  "memo": "変更メモ",      // 任意
  "trust": true           // 任意: URLパスが変わる
}`}
              </pre>
            </div>
          </div>

          {/* QRコード画像 */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              GET /api/qr/:id
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              ツール公開URLのQRコードをPNG画像で返します。
              <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm ml-1">
                ?size=300
              </code>
              でサイズ指定（100-500、デフォルト300）。
            </p>
          </div>

          {/* OpenAPI */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              GET /api/openapi
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              OpenAPI仕様を取得します。ChatGPT Actions等で利用可能。
              <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm ml-1">
                ?format=json
              </code>
              でJSON形式。
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Viewer
          </h2>
          <div className="space-y-4">
            <div>
              <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm">
                /tool/:id
              </code>
              <span className="text-zinc-600 dark:text-zinc-400 ml-2">
                通常モード - iframe sandbox内で表示
              </span>
            </div>
            <div>
              <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm">
                /tool-trust/:id
              </code>
              <span className="text-zinc-600 dark:text-zinc-400 ml-2">
                信頼モード - localStorage等が使用可能
              </span>
            </div>
            <div>
              <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm">
                /qr/:id
              </code>
              <span className="text-zinc-600 dark:text-zinc-400 ml-2">
                共有用QRコードを中央に表示するページ（
                <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">?size=</code>
                でサイズ指定可）
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            MCP Server
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            Claude、Cursor等のAIエージェントから直接利用可能。
            APIキー無しでも接続できますが、揮発モードのみ書き込み可能になります。
          </p>
          <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4 overflow-x-auto">
            <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "mcpServers": {
    "html-publisher": {
      "url": "https://your-domain.com/api/mcp/mcp?key=your-api-key"
    }
  }
}`}
            </pre>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-4">
            提供ツール: <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">how_to_use</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">get_status</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">create_tool</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">get_tool</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">update_tool</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">import_gist</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">list_recent_tools</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">get_gist_url</code>{" "}
            <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">get_qr_code</code>
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            まず <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-xs">how_to_use</code> を呼ぶと、現在の認証状態と利用可能な操作が冒頭に含まれた使い方ガイドが返ります。
          </p>
        </section>
      </main>
    </div>
  );
}
