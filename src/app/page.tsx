export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black font-sans">
      <main className="max-w-3xl mx-auto py-16 px-6">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">
          HTML Publisher
        </h1>

        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-8">
          ChatGPTなどで生成した単一HTMLファイルをAPI経由で公開し、URLを取得できます。
        </p>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            API Reference
          </h2>

          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              POST /api/tools
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              HTMLを登録し、公開URLを取得します。
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4 overflow-x-auto">
              <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/tools \\
  -H "Content-Type: application/json" \\
  -d '{"html":"<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"}'`}
              </pre>
            </div>
            <div className="mt-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">Response:</p>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded p-4">
                <pre className="text-sm text-zinc-800 dark:text-zinc-200">
{`{
  "id": "abc123...",
  "url": "https://your-domain.com/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/..."
}`}
                </pre>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
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
  "rawUrl": "https://gist.githubusercontent.com/..."
}`}
              </pre>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Viewer
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            <code className="bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded text-sm">
              /tool/:id
            </code>
            にアクセスすると、HTMLがiframe sandbox内で表示されます。
          </p>
        </section>
      </main>
    </div>
  );
}
