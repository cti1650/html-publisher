export const HOW_TO_USE_GUIDE = `# HTML Publisher 使い方ガイド

このMCPサーバーは、HTMLコンテンツをURL公開して共有するためのツールを提供します。
**新規にツールを実装する必要はありません。以下のMCPツールを組み合わせて使用してください。**

## 提供されるMCPツール

| ツール | 用途 |
|---|---|
| \`create_tool\` | HTMLを新規作成して公開URLを取得（\`ephemeral: true\` で揮発モード） |
| \`get_tool\` | IDからHTMLソースを取得（揮発・永続を自動判別） |
| \`update_tool\` | 既存ツールのHTMLを上書き更新 |
| \`import_gist\` | 手動で作成済みのGistをHTML Publisher管理下に取り込み（永続モード専用、HTMLは変更しない） |
| \`list_recent_tools\` | 直近のツール一覧を取得（永続モードのみ） |
| \`get_gist_url\` | GistをGitHub上で編集するためのURLを取得（永続モード専用） |
| \`get_qr_code\` | ツール共有用QRコードを中央に表示するページのURLを取得 |

## ストレージモード

### 永続モード（Gist）
- GitHub Gist に保存される
- ID は 32文字の16進数（例: \`abc123def456...\`）
- \`GITHUB_TOKEN\` が設定されている時のデフォルト
- 永続的に残る。本格運用・通常の公開向け

### 揮発モード（Cache）
- Upstash Redis (本番) または in-memory (開発) に保存
- ID は \`c_\` プレフィックス付き（例: \`c_lwxyz-a1b2c3d4\`）
- \`ephemeral: true\` を指定するか、\`GITHUB_TOKEN\` 未設定時に自動選択
- **APIキー無しの匿名アクセス時は強制的に揮発モードになる**（Gist 書き込みは認証必須）
- **最終アクセスから一定時間（デフォルト6時間）で自動削除**（アクセス毎にTTL延長）
- ハッカソン、一時共有、Gistを残したくない用途に推奨
- **\`list_recent_tools\` には含まれない**（プライバシー保護）。共有相手にURL/IDを直接伝える運用

## 認証ステータスによる挙動の違い

このMCPサーバーには3つの認証ステータスがあります（APIキーは \`?key=...\` クエリ または \`x-api-key\` ヘッダで提示）:

- **認証済み**: 正しいAPIキー
- **匿名**: APIキー未提示（または環境変数未設定で検証不能）
- **拒否**: APIキー不正 → 全リクエストが 401

ツール別の挙動:

| ツール | 認証済み | 匿名 | 拒否 |
|---|---|---|---|
| \`how_to_use\` | OK | OK | 401 |
| \`create_tool\` | 永続/揮発どちらも作成可 | **揮発モード強制**（\`ephemeral\` 指定は無視され常に揮発） | 401 |
| \`get_tool\` | OK | OK | 401 |
| \`update_tool\` | 永続/揮発どちらも更新可 | 揮発ID（\`c_\`〜）のみ更新可。永続Gist ID指定時はエラー | 401 |
| \`import_gist\` | OK | **エラー**（認証必須） | 401 |
| \`list_recent_tools\` | OK（永続のみ表示） | OK（永続のみ表示） | 401 |
| \`get_gist_url\` | OK（永続のみ） | OK（永続のみ） | 401 |
| \`get_qr_code\` | OK | OK | 401 |

匿名で書き込み系を試みた時の代表的なエラー:
- \`update_tool\` で永続Gist ID指定時: \`永続モード（Gist）の更新には認証が必要です...\`
- \`import_gist\` 呼び出し時: \`import_gistの実行には認証が必要です...\`

## 推奨ワークフロー

### 1. 新規HTML作成 → 公開
1. HTMLを生成する前に、ユーザーに「どのようなHTMLを作成するか」「name/memoの内容」「trustモードの有無」「揮発か永続か」を説明し確認を取る
2. \`create_tool\` を実行（必要なら \`ephemeral: true\` を付与）
3. 返却された \`url\` と \`id\` をユーザーに提示
4. QR共有が必要な場合は \`get_qr_code\` を呼ぶ

### 2. 既存HTMLの修正
1. 修正対象のIDをユーザーから受け取る（URLの末尾部分、\`c_\` プレフィックス有無で揮発/永続を識別）
2. 必要に応じて \`get_tool\` で現状のHTMLを確認
3. ユーザーに「どのような変更を行うか」を説明し確認を取る
4. \`update_tool\` で上書き更新（揮発・永続の判別はIDから自動）

### 3. メタデータのみ変更（永続モードのみ）
- HTMLは変更せず name/memo/trust だけ変えたい場合は \`import_gist\` を使う（\`update_tool\` ではない）
- 揮発モード（\`c_\` で始まるID）には使えない

### 4. ツール一覧確認
- \`list_recent_tools\` で直近10件まで取得可能（**永続モードのみ**、HTMLなし）
- 揮発モードのツールは作成時に返されるURL/IDをユーザー側で記録しておくこと

## 重要な判断基準

### 永続モード vs 揮発モード（ephemeral）
- **デフォルト（永続/Gist）**: 残しておきたいツール、本格運用、複数回アクセスする運用
- **揮発（ephemeral: true）**: 以下に該当する場合に推奨
  - ハッカソンやイベントの一時共有
  - 短時間のデモ用途
  - Gist を残したくない（GitHub アカウントを汚したくない）
  - サンドボックス的な試作
- 揮発モードは作成時のURL/IDを失うと取り戻せない（一覧に出ない）ため、ユーザーに必ず保存を促す

### trustモード（信頼モード）の使い分け
- **デフォルト（trust: false）**: iframe sandboxで隔離実行。安全。基本これでOK
- **trust: true**: iframe sandboxを無効化、HTMLがページ内で直接実行される
  - localStorage / sessionStorage が使いたい時
  - PWAでcamera / microphone を使いたい時
  - **必ず \`confirm_trust: true\` を併せて指定**（指定しないとエラーになる）
  - ユーザーへの事前説明と承認が必須

### nameとmemoの使い方
- **name**: ツールの名前。PWAホーム画面表示やSlack通知で使われる
- **memo**: 変更内容の説明。更新履歴の記録として使う
- どちらも省略可能だが、後から見返す時のために設定推奨

### IDの形式（揮発・永続の見分け方）
- **永続モード（Gist）**: 32文字の16進数（例: \`abc123def456789...\`）
- **揮発モード（Cache）**: \`c_\` プレフィックス付き（例: \`c_lwxyz123-a1b2c3d4\`）
- ツールURLの末尾部分がそのままID

### IDから各種URLを組み立てる
ID と \`trust\` フラグからユーザーに提示するURLを構成できる。\`get_tool\` の返却値に \`url\` / \`rawUrl\` が入っているので、基本はそれを使えば十分（自前で組み立てる必要はない）。

| URL種別 | パターン |
|---|---|
| ツール公開URL（\`trust: false\`） | \`<base>/tool/<id>\` |
| ツール公開URL（\`trust: true\`） | \`<base>/tool-trust/<id>\` |
| QRコード表示ページ | \`<base>/qr/<id>?size=<100-500>\`（\`get_qr_code\` の \`qrPageUrl\`） |
| Gist編集ページ（永続のみ） | \`https://gist.github.com/<user>/<id>\`（\`get_gist_url\` の \`gistUrl\`） |

## HTML作成のヒント（CDN活用例）

\`create_tool\` / \`update_tool\` で公開するHTMLは**単一ファイル完結**が原則（外部ファイル参照不可）。CSS/JSはインラインかCDN、画像はBase64またはCDN URLにする。よく使うCDNを以下に挙げる（必要なものだけ取り込む）。

### フレームワーク・スタイリング
\`\`\`html
<!-- React 18 + Babel（React 19 はUMDビルド廃止のため18系を使用） -->
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

<!-- Tailwind CSS v4 -->
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
\`\`\`

### アイコン・フォント
\`\`\`html
<!-- Lucide Icons（軽量SVGアイコン） -->
<script src="https://unpkg.com/lucide@latest"></script>

<!-- Font Awesome 6 -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">

<!-- Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">

<!-- Material Symbols -->
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
\`\`\`

### チャート・可視化
\`\`\`html
<!-- Chart.js -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>

<!-- Mermaid（図・フローチャート） -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
\`\`\`

### ユーティリティ
\`\`\`html
<!-- day.js（日付操作） -->
<script src="https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dayjs@1/locale/ja.js"></script>

<!-- marked（Markdownレンダリング） -->
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>

<!-- highlight.js（シンタックスハイライト） -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>

<!-- html2canvas（スクリーンショット・画像エクスポート） -->
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1"></script>

<!-- QRコード生成（クライアント側でQRが必要な場合） -->
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1/qrcode.js"></script>

<!-- Sortable.js（ドラッグ&ドロップ並び替え） -->
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1"></script>
\`\`\`

### アニメーション
\`\`\`html
<!-- Animate.css -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">

<!-- GSAP -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3"></script>
\`\`\`

### ブラウザAPIを使う場合の注意
- カメラ/マイク/localStorage/ServiceWorker などは iframe sandbox に阻まれる
- それらが必要なツールでは \`trust: true\` + \`confirm_trust: true\` を併記する（ユーザー承認を取った上で）

## トラブルシューティング

- **Tool not found エラー**:
  - 永続モード: IDが間違っている、または該当Gistが削除されている
  - 揮発モード: TTLが切れて削除された、またはIDが間違っている
- **Unauthorized エラー**: APIキーが必要。クライアント設定の \`?key=...\` を確認
- **trust指定でエラー**: \`confirm_trust: true\` を併記する
- **揮発モードのツールに \`import_gist\` / \`get_gist_url\` を使った場合**: 揮発モードはGistと無関係なのでエラーになる（仕様）

## ユーザー確認のタイミング

以下の操作を行う前に、必ずユーザーに内容を説明して承認を取ること:
- \`create_tool\` の実行（新規HTML公開）
- \`update_tool\` の実行（既存HTMLの上書き）
- \`import_gist\` の実行（メタデータ追加）
- \`trust: true\` の指定（信頼モード有効化）
- \`ephemeral: true\` の指定（揮発モード選択。永続したいツールでは指定しない）

ユーザー承認なしの自動実行は避けてください。
`;
