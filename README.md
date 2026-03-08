# HTML Publisher

ChatGPTなどで生成した単一HTMLファイルをAPI経由で公開し、URLを取得できるツール。

## 機能

- HTMLファイルをAPI経由で登録
- GitHub Gistに保存
- 公開URLを発行
- iframe sandboxで安全に実行

## 環境構築

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local`を作成し、GitHub Personal Access Token を設定：

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

GitHub Personal Access Token (PAT) の作成方法：
1. https://github.com/settings/tokens にアクセス
2. "Generate new token (classic)" をクリック
3. `gist` スコープにチェックを入れる
4. トークンを生成してコピー

### 3. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 で起動します。

## API仕様

### 認証

書き込み系API（POST, PUT）はAPIキー認証に対応しています。

- クエリパラメータ: `?key=your-api-key`
- ヘッダー: `X-API-Key: your-api-key`

※ `API_KEY`が未設定の場合、認証はスキップされます（ローカル開発用）。

### HTML登録

```
POST /api/tools?key=your-api-key
Content-Type: application/json

Request:
{
  "html": "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"
}

Response (201):
{
  "id": "abc123...",
  "url": "https://html-publisher-zeta.vercel.app/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/..."
}
```

### ツール取得

```
GET /api/tools/:id

Response (200):
{
  "id": "abc123...",
  "html": "<!DOCTYPE html>...",
  "rawUrl": "https://gist.githubusercontent.com/..."
}
```

### ツール更新

```
PUT /api/tools/:id?key=your-api-key
Content-Type: application/json

Request:
{
  "html": "<!DOCTYPE html><html><body><h1>Updated</h1></body></html>"
}

Response (200):
{
  "id": "abc123...",
  "url": "https://html-publisher-zeta.vercel.app/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/..."
}
```

### OpenAPI仕様取得

```
GET /api/openapi
GET /api/openapi?format=json

Response (200):
# YAML または JSON形式のOpenAPI仕様
# serversはリクエスト元のドメインに動的に設定
```

外部ツール（Swagger UI、Postman、ChatGPT Actions等）にURLを渡して利用可能。

## MCP Server

AIエージェント（Claude、Cursor等）から直接利用可能なMCPサーバーエンドポイント。

### エンドポイント

```
https://html-publisher-zeta.vercel.app/api/mcp/mcp
```

ローカル開発時は `http://localhost:3000/api/mcp/mcp` を使用してください。

### 認証

MCPエンドポイントはAPIキー認証に対応しています。

1. APIキーを生成：
   ```bash
   openssl rand -hex 32
   ```

2. 環境変数に設定：
   ```env
   API_KEY=your-generated-key
   ```

3. リクエスト時にキーを渡す：
   - クエリパラメータ: `?key=your-key`
   - ヘッダー: `X-API-Key: your-key`

※ `API_KEY`が未設定の場合、認証はスキップされます（ローカル開発用）。

### 提供ツール

| ツール名 | 説明 |
|---------|------|
| `create_tool` | HTMLを新規作成し公開URLを取得 |
| `get_tool` | IDからHTMLソースを取得 |
| `update_tool` | 既存ツールのHTMLを上書き更新 |

### クライアント設定例

#### Streamable HTTP対応クライアント（Cursor等）

```json
{
  "mcpServers": {
    "html-publisher": {
      "url": "https://html-publisher-zeta.vercel.app/api/mcp/mcp?key=your-api-key"
    }
  }
}
```

#### stdio専用クライアント（Claude Desktop等）

```json
{
  "mcpServers": {
    "html-publisher": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://html-publisher-zeta.vercel.app/api/mcp/mcp?key=your-api-key"]
    }
  }
}
```

## Viewer

`/tool/:id` にアクセスすると、HTMLがiframe sandbox内で表示されます。

### セキュリティ

- `sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"` で実行
- 以下のPermissions Policyを許可:
  - `geolocation` - 位置情報
  - `accelerometer`, `gyroscope`, `magnetometer` - センサー
  - `camera`, `microphone` - カメラ・マイク
  - `fullscreen` - フルスクリーン
  - `clipboard-read`, `clipboard-write` - クリップボード
  - `web-share` - Web Share API
- top navigation、cookie access、parent access は禁止

## デプロイ (Vercel)

1. GitHubにリポジトリを作成してプッシュ
2. Vercelでリポジトリをインポート
3. 環境変数を設定：
   - `GITHUB_TOKEN`: GitHub Personal Access Token
   - `API_KEY`: MCPエンドポイント認証用キー（任意）
   - `SLACK_WEBHOOK_URL`: Slack通知用Webhook URL（任意）
4. デプロイ

※ `VERCEL_URL`は自動設定されるため、URLの設定は不要です。

## 技術スタック

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- GitHub Gist API
- MCP (Model Context Protocol)
