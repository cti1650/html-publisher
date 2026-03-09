export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black font-sans">
      <main className="max-w-3xl mx-auto py-16 px-6">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
          HTML Publisher
        </h1>

        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-8">
          ChatGPTなどで生成した単一HTMLファイルをAPI経由で公開し、URLを取得できます。
        </p>

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
              直近で作成・更新されたツールの一覧を取得します（最大10件）。
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
    "updatedAt": "2024-01-15T12:00:00Z"
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
  "trust": false          // 任意: trueでlocalStorage等を許可
}`}
              </pre>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">Response:</p>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4">
                <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "id": "abc123...",
  "url": "https://your-domain.com/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/...",
  "trust": false
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
              登録済みHTMLの情報を取得します。
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4">
              <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "id": "abc123...",
  "html": "<!DOCTYPE html>...",
  "rawUrl": "https://gist.githubusercontent.com/...",
  "url": "https://your-domain.com/tool/abc123...",
  "trust": false
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
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            MCP Server
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            Claude、Cursor等のAIエージェントから直接利用可能。
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
            提供ツール: create_tool, get_tool, update_tool, add_metadata, list_recent_tools, get_gist_url
          </p>
        </section>
      </main>
    </div>
  );
}
