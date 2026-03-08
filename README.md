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

### HTML登録

```
POST /api/tools
Content-Type: application/json

Request:
{
  "html": "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"
}

Response (201):
{
  "id": "abc123...",
  "url": "https://your-domain.com/tool/abc123...",
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

## Viewer

`/tool/:id` にアクセスすると、HTMLがiframe sandbox内で表示されます。

### セキュリティ

- `sandbox="allow-scripts allow-forms"` で実行
- top navigation、cookie access、parent access は禁止

## デプロイ (Vercel)

1. GitHubにリポジトリを作成してプッシュ
2. Vercelでリポジトリをインポート
3. 環境変数 `GITHUB_TOKEN` を設定
4. デプロイ

## 技術スタック

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- GitHub Gist API
