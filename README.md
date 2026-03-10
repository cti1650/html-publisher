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

API_KEYは`SECRET`と`GITHUB_TOKEN`のハッシュから動的に検証されます。
詳細は「MCP Server > 認証」セクションを参照してください。

※ `SECRET`が未設定の場合、認証はスキップされます（ローカル開発用）。

### ツール一覧取得

```
GET /api/tools?limit=10

Response (200):
[
  {
    "id": "abc123...",
    "name": "コンパスアプリ",
    "memo": "方位を表示",
    "trust": true,
    "url": "https://html-publisher-zeta.vercel.app/tool-trust/abc123...",
    "updatedAt": "2024-01-15T12:00:00Z"
  }
]
```

`limit`パラメータで取得件数を指定（1-10、デフォルト10）。HTMLソースは含まれません。

### HTML登録

```
POST /api/tools?key=your-api-key
Content-Type: application/json

Request:
{
  "html": "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>",
  "name": "コンパスアプリ",  // 任意: ツール名
  "memo": "初回作成",  // 任意: 変更メモ
  "trust": false  // 任意: 信頼モード（trueでlocalStorage等を許可）
}

Response (201):
{
  "id": "abc123...",
  "url": "https://html-publisher-zeta.vercel.app/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/...",
  "trust": false
}
```

`name`、`memo`、`trust`を指定すると:
- Gistの説明に反映: `コンパスアプリ - 初回作成`
- HTML内に`<meta name="tool-name" content="コンパスアプリ">`を挿入
- HTML内に`<meta name="tool-memo" content="初回作成">`を挿入
- HTML内に`<meta name="tool-trust" content="true">`を挿入（trueの場合）
- Slack通知にツール名、メモ、信頼モードを表示
- `trust: true`の場合、URLが`/tool-trust/{id}`になり、localStorage等が使用可能

### ツール取得

```
GET /api/tools/:id

Response (200):
{
  "id": "abc123...",
  "html": "<!DOCTYPE html>...",
  "rawUrl": "https://gist.githubusercontent.com/...",
  "url": "https://html-publisher-zeta.vercel.app/tool/abc123...",
  "trust": false
}
```

### ツール更新

```
PUT /api/tools/:id?key=your-api-key
Content-Type: application/json

Request:
{
  "html": "<!DOCTYPE html><html><body><h1>Updated</h1></body></html>",
  "name": "コンパスアプリ",  // 任意: ツール名
  "memo": "ボタンの色を変更",  // 任意: 変更メモ
  "trust": true  // 任意: 信頼モード
}

Response (200):
{
  "id": "abc123...",
  "url": "https://html-publisher-zeta.vercel.app/tool-trust/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/...",
  "trust": true
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

MCPエンドポイントはAPIキー認証に対応しています。API_KEYは`SECRET`と`GITHUB_TOKEN`から動的に生成されます。

1. SECRETを生成して環境変数に設定：
   ```bash
   openssl rand -hex 32
   ```
   ```env
   SECRET=your-generated-secret
   GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```

2. API_KEYを生成：
   ```bash
   npm run generate-api-key
   ```
   または手動で：
   ```bash
   echo -n "${SECRET}${GITHUB_TOKEN}" | shasum -a 256
   ```

3. リクエスト時にAPI_KEYを渡す：
   - クエリパラメータ: `?key=your-api-key`
   - ヘッダー: `X-API-Key: your-api-key`

※ `SECRET`が未設定の場合、認証はスキップされます（ローカル開発用）。
※ `GITHUB_TOKEN`を変更するとAPI_KEYも変わるため、古いキーは無効化されます。

### 提供ツール

| ツール名 | 説明 |
|---------|------|
| `create_tool` | HTMLを新規作成し公開URLを取得 |
| `get_tool` | IDからHTMLソースを取得 |
| `update_tool` | 既存ツールのHTMLを上書き更新（htmlパラメータ必須） |
| `import_gist` | 既存Gistにメタデータのみ追加（HTMLは変更しない） |
| `list_recent_tools` | 直近のツール一覧を取得（最大10件、HTMLなし） |
| `get_gist_url` | Gistの編集ページURLを取得 |

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

### 通常モード: `/tool/:id`

HTMLがiframe sandbox内で表示されます。

**セキュリティ設定:**
- `sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"`
- 以下のPermissions Policyを許可:
  - `geolocation` - 位置情報
  - `accelerometer`, `gyroscope`, `magnetometer` - センサー
  - `camera`, `microphone` - カメラ・マイク
  - `fullscreen` - フルスクリーン
  - `clipboard-read`, `clipboard-write` - クリップボード
  - `web-share` - Web Share API
- top navigation、cookie access は禁止

### 信頼モード: `/tool-trust/:id`

`trust: true`で作成されたツール専用のエンドポイントです。

**追加で許可される機能:**
- `localStorage` / `sessionStorage` - データ永続化
- `allow-downloads` - ファイルダウンロード
- `allow-pointer-lock` - ポインターロック
- `storage-access` - ストレージアクセス

**注意:** 信頼モードはセキュリティ制限が緩和されるため、信頼できるHTMLコンテンツにのみ使用してください。
`trust`フラグが設定されていないツールは`/tool-trust/`でアクセスしても404になります。

### PWA対応

各ツールページはPWA（Progressive Web App）に対応しています。

- **ホーム画面に追加**: ツールをスマートフォンのホーム画面に追加してアプリのように使用可能
- **オフライン対応**: 一度表示したツールはキャッシュされ、オフラインでも閲覧可能
- **スタンドアロン表示**: ブラウザのUIなしでフルスクリーン表示

ツール名（`name`）とメモ（`memo`）はmanifest.jsonに反映され、ホーム画面のアプリ名や説明として表示されます。

## デプロイ (Vercel)

1. GitHubにリポジトリを作成してプッシュ
2. Vercelでリポジトリをインポート
3. 環境変数を設定：
   - `GITHUB_TOKEN`: GitHub Personal Access Token
   - `SECRET`: API_KEY生成用シークレット（任意、設定推奨）
   - `SLACK_WEBHOOK_URL`: Slack通知用Webhook URL（任意）
   - `BASE_URL`: ツールURLのベースドメイン（任意、例: `https://html-publisher-zeta.vercel.app`）
4. デプロイ

※ `VERCEL_URL`は自動設定されるため、URLの設定は不要です。

## 技術スタック

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- GitHub Gist API
- MCP (Model Context Protocol)
- PWA (Service Worker)
