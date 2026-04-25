# HTML Publisher

ChatGPTなどで生成した単一HTMLファイルをAPI経由で公開し、URLを取得できるツール。

![screenshot](https://gyazo.com/5281ed21d0e631ee4e0c76aa910c8f3c.png)

**セルフホスト型MCP Server** - 自分のGitHubアカウントとVercel（または他のホスティング）にデプロイして使用します。公開サービスではないため、各自でのセットアップが必要です。

## 機能

- HTMLファイルをAPI経由で登録
- GitHub Gistに保存（永続モード）または Upstash Redis にキャッシュ保存（揮発モード）
- 公開URLを発行
- iframe sandboxで安全に実行

## ストレージモード

| モード | 保存先 | ID形式 | 寿命 | 用途 |
|---|---|---|---|---|
| 永続 | GitHub Gist | 32文字hex（例: `abc123...`） | 永続 | 通常の公開・本格運用 |
| 揮発 | Upstash Redis (or in-memory) | `c_<timestamp36>-<hash8>` | 最終アクセスから6時間（環境変数で変更可） | ハッカソン、一時共有、Gist残したくない時 |

- アクセス毎に TTL がスライド延長されるため、使われ続けている限り消えません
- `ephemeral: true` を指定するか、`GITHUB_TOKEN` 未設定時に自動で揮発モードになります
- `get/update` は ID 形式から自動判別（`c_` で始まれば揮発、それ以外は Gist）
- **揮発モードのエントリは `list` 系 API には含まれません**（API key はデプロイ単位の単一キーでユーザー識別ができないため、第三者に他人の cache ID が列挙される事故を防ぐ目的）。揮発ツールの URL/ID は作成時に保存し、共有相手にのみ伝えてください

## 環境構築

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local`を作成し、用途に応じて以下を設定：

```env
# 永続モード（Gist）を使う場合
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# 揮発モード（キャッシュ）を使う場合
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxx
CACHE_TTL_SECONDS=21600  # 任意。デフォルト 6時間（21600秒）
```

両方設定しても OK（その場合デフォルトは Gist、`ephemeral: true` で揮発モードに切り替え）。
両方未設定の場合、ローカル開発用の in-memory キャッシュが使われます（プロセス再起動で消える）。

GitHub Personal Access Token (PAT) の作成方法：
1. https://github.com/settings/tokens にアクセス
2. "Generate new token (classic)" をクリック
3. `gist` スコープにチェックを入れる
4. トークンを生成してコピー

Upstash Redis の準備:
1. https://console.upstash.com/redis にアクセス
2. データベースを作成（無料枠で十分）
3. "REST API" タブから `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` を取得

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
    "url": "https://example.com/tool-trust/abc123...",
    "updatedAt": "2024-01-15T12:00:00Z",
    "mode": "gist"
  }
]
```

`limit`パラメータで取得件数を指定（1-10、デフォルト10）。HTMLソースは含まれません。**永続モード（Gist）のエントリのみ返されます**。揮発モード（cache）はプライバシー保護のため一覧に含まれません。

### HTML登録

```
POST /api/tools?key=your-api-key
Content-Type: application/json

Request:
{
  "html": "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>",
  "name": "コンパスアプリ",  // 任意: ツール名
  "memo": "初回作成",  // 任意: 変更メモ
  "trust": false,  // 任意: 信頼モード（trueでlocalStorage等を許可）
  "ephemeral": false  // 任意: 揮発モード（trueでキャッシュ保存・6時間TTL）
}

Response (201):
{
  "id": "abc123...",
  "url": "https://example.com/tool/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/...",  // 永続モードのみ
  "trust": false,
  "mode": "gist"  // "gist" or "cache"
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
  "rawUrl": "https://gist.githubusercontent.com/...",  // 永続モードのみ
  "url": "https://example.com/tool/abc123...",
  "trust": false,
  "mode": "gist"  // "gist" or "cache"
}
```

ID 形式から自動判別され、永続・揮発どちらでも同じエンドポイントで取得できます。揮発モードのエントリはアクセス毎に TTL が延長されます。

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
  "url": "https://example.com/tool-trust/abc123...",
  "rawUrl": "https://gist.githubusercontent.com/...",  // 永続モードのみ
  "trust": true,
  "mode": "gist"
}
```

ID 形式（`c_` で始まるかどうか）から自動的に揮発・永続どちらを更新するか判別されます。

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
https://example.com/api/mcp/mcp
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
| `create_tool` | HTMLを新規作成し公開URLを取得（`ephemeral: true` で揮発モード） |
| `get_tool` | IDからHTMLソースを取得（揮発・永続を自動判別） |
| `update_tool` | 既存ツールのHTMLを上書き更新（htmlパラメータ必須） |
| `import_gist` | 既存Gistにメタデータのみ追加（永続モード専用） |
| `list_recent_tools` | 直近のツール一覧を取得（最大10件、永続モードのみ。揮発はプライバシー保護のため含まない） |
| `get_gist_url` | Gistの編集ページURLを取得（永続モード専用） |
| `get_qr_code` | ツール共有用QRコードのURLを取得 |

### 信頼モード（trust）の安全機構

`trust: true`を指定する場合、`confirm_trust: true`も同時に指定する必要があります。

```json
{
  "trust": true,
  "confirm_trust": true
}
```

`confirm_trust`が指定されていない場合、ツールはエラーを返しAIエージェントにユーザー確認を促します。これにより意図しない信頼モードの有効化を防ぎます。

### Claude Code スキルプラグイン

Claude Codeを使用する場合、専用のスキルプラグインを導入することでHTMLの作成・管理ワークフローが最適化されます。

**インストール:**
```bash
# マーケットプレイスを追加
/plugin marketplace add cti1650/html-publisher-skills

# プラグインをインストール
/plugin install html-publisher-skills@html-publisher-marketplace
```

**アップデート:**
```bash
/plugin marketplace update html-publisher-marketplace
/plugin install html-publisher-skills@html-publisher-marketplace
```

**アンインストール:**
```bash
# プラグインを削除
/plugin disable html-publisher-skills@html-publisher-marketplace

# マーケットプレイスごと削除する場合
/plugin marketplace remove html-publisher-marketplace
```

詳細: https://github.com/cti1650/html-publisher-skills

### クライアント設定例

#### Streamable HTTP対応クライアント（Cursor等）

```json
{
  "mcpServers": {
    "html-publisher": {
      "url": "https://example.com/api/mcp/mcp?key=your-api-key"
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
      "args": ["-y", "mcp-remote", "https://example.com/api/mcp/mcp?key=your-api-key"]
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

**iframeを使用せず、HTMLを直接レンダリングします。** これにより以下が可能になります：

- `localStorage` / `sessionStorage` - データ永続化
- `camera` / `microphone` - PWAモードでも動作
- ファイルダウンロード
- すべてのブラウザAPI

**警告:** 信頼モードはHTMLがページ内で直接実行されるため、**完全に自己責任**です。セルフホスト環境で自分が登録したHTMLのみを信頼モードで使用してください。
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
   - `GITHUB_TOKEN`: GitHub Personal Access Token（永続モード使用時）
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis 接続情報（揮発モード使用時）
   - `CACHE_TTL_SECONDS`: 揮発モードの TTL 秒数（任意、デフォルト 21600 = 6時間）
   - `SECRET`: API_KEY生成用シークレット（任意、設定推奨）
   - `SLACK_WEBHOOK_URL`: Slack通知用Webhook URL（任意）
   - `BASE_URL`: ツールURLのベースドメイン（任意、例: `https://example.com`）

   ※ Vercel にデプロイする場合、揮発モードを使う場合は Upstash 必須です。Vercel の Lambda 環境ではプロセスメモリが共有されないため、Upstash 未設定だと in-memory フォールバックではアクセス毎にツールが消えたように見えます。
4. デプロイ

※ `VERCEL_URL`は自動設定されるため、URLの設定は不要です。

## 技術スタック

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- GitHub Gist API
- MCP (Model Context Protocol)
- PWA (Service Worker)
