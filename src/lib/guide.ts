export const HOW_TO_USE_GUIDE = `# HTML Publisher 使い方ガイド

このMCPサーバーは、HTMLコンテンツをURL公開して共有するためのツールを提供します。
**新規にツールを実装する必要はありません。以下のMCPツールを組み合わせて使用してください。**

## 提供されるMCPツール

| ツール | 用途 |
|---|---|
| \`create_tool\` | HTMLを新規作成して公開URLを取得 |
| \`get_tool\` | IDからHTMLソースを取得 |
| \`update_tool\` | 既存ツールのHTMLを上書き更新 |
| \`import_gist\` | 手動で作成済みのGistをHTML Publisher管理下に取り込み（HTMLは変更しない） |
| \`list_recent_tools\` | 直近のツール一覧を取得 |
| \`get_gist_url\` | GistをGitHub上で編集するためのURLを取得 |
| \`get_qr_code\` | ツール共有用QRコード画像を取得 |

## 推奨ワークフロー

### 1. 新規HTML作成 → 公開
1. HTMLを生成する前に、ユーザーに「どのようなHTMLを作成するか」「name/memoの内容」「trustモードの有無」を説明し確認を取る
2. \`create_tool\` を実行
3. 返却された \`url\` をユーザーに提示
4. QR共有が必要な場合は \`get_qr_code\` を呼ぶ

### 2. 既存HTMLの修正
1. 修正対象のIDをユーザーから受け取る（URLの末尾部分）
2. 必要に応じて \`get_tool\` で現状のHTMLを確認
3. ユーザーに「どのような変更を行うか」を説明し確認を取る
4. \`update_tool\` で上書き更新

### 3. メタデータのみ変更
- HTMLは変更せず name/memo/trust だけ変えたい場合は \`import_gist\` を使う（\`update_tool\` ではない）

### 4. ツール一覧確認
- \`list_recent_tools\` で直近10件まで取得可能。HTMLソースは含まれないので軽量

## 重要な判断基準

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

### IDの形式
- Gist ID: 32文字の16進数（例: \`abc123def456...\`）
- ツールURLの末尾部分がそのままID

## トラブルシューティング

- **Tool not found エラー**: IDが間違っている、または該当Gistが削除されている
- **Unauthorized エラー**: APIキーが必要。クライアント設定の \`?key=...\` を確認
- **trust指定でエラー**: \`confirm_trust: true\` を併記する

## ユーザー確認のタイミング

以下の操作を行う前に、必ずユーザーに内容を説明して承認を取ること:
- \`create_tool\` の実行（新規HTML公開）
- \`update_tool\` の実行（既存HTMLの上書き）
- \`import_gist\` の実行（メタデータ追加）
- \`trust: true\` の指定（信頼モード有効化）

ユーザー承認なしの自動実行は避けてください。
`;
