// 実装サンプル（テンプレート）の一覧と読み込み。
//
// テンプレート本体は src/templates/<id>.html に置く。TS の文字列に埋め込むと
// テンプレート内JSのバッククォートや ${} のエスケープが必要になり保守しづらいため。
// Vercel 上でも読めるよう next.config.ts の outputFileTracingIncludes に含めている。
//
// trustRequired は security_check の recommendation.trustRequired と一致させる
// （templates.test.ts で検証）。

import { readFile } from "node:fs/promises";
import path from "node:path";

export const TEMPLATE_IDS = [
  "basic-webapp",
  "slides",
  "userscript-installer",
  "chrome-extension-zip",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateInfo {
  id: TemplateId;
  title: string;
  description: string;
  /** どういう依頼のときにこのテンプレートを選ぶか */
  useWhen: string;
  /** create_tool で trust: true が必要か（security_check の判定と一致） */
  trustRequired: boolean;
  /** trust の有無で挙動が変わる点の補足 */
  trustNote: string;
  /** AI が書き換える箇所。マーカーで囲まれた範囲を差し替える */
  editPoints: string[];
}

export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: "basic-webapp",
    title: "シンプルなWebアプリ（React + Tailwind CSS）",
    description:
      "React 18（UMD + Babel）と Tailwind CSS v4 をCDNから読み込む単一HTMLのWebアプリ。サンプルとしてToDoリストを実装している",
    useWhen: "フォーム・計算機・一覧管理など、ブラウザ内で完結する一般的なツールを作るとき",
    trustRequired: false,
    trustNote:
      "iframe 内（about:srcdoc）では localStorage も history.replaceState も使えないため、状態はメモリ上だけで持つ。リロード後も残したい場合は trust: true にして localStorage を使う",
    editPoints: [
      "`// ===== APP:START =====` 〜 `// ===== APP:END =====` の App コンポーネントを差し替える",
      "<title> を変更する",
    ],
  },
  {
    id: "slides",
    title: "スライド（Reveal.js + PDF保存 + 全画面）",
    description:
      "Reveal.js 5 のスライド。右上に「全画面」「PDF保存」ボタンを持つ。PDF保存は印刷ダイアログで「PDFに保存」を選ぶ方式",
    useWhen: "発表資料・説明資料・スライド形式のまとめを作るとき",
    trustRequired: false,
    trustNote:
      "trust: false でもスライド表示・全画面・PDF保存（印刷ビューで初期化し直して印刷し、印刷後に再読み込みで通常表示に戻す）が動く（Chromium で確認済み）。ブラウザによって iframe 内の全画面が拒否された場合は、ブラウザ自体の全画面表示を案内するメッセージを出す。trust: true では Reveal.js 公式の ?print-pdf 付きページを別タブで開いて印刷する",
    editPoints: [
      "`<!-- SLIDES:START -->` 〜 `<!-- SLIDES:END -->` の <section> を差し替える（縦方向のサブスライドは section を入れ子）",
      "テーマを変える場合は theme/white.css のファイル名を変更する",
      "<title> を変更する",
    ],
  },
  {
    id: "userscript-installer",
    title: "UserScript / ブックマークレット導入支援ページ",
    description:
      "Tampermonkey 用 UserScript を表示・コピーするページ。メタデータ（@match / @grant 等）を一覧表示し、@grant none のときはブックマークレットも自動生成する",
    useWhen: "Tampermonkey 用のユーザースクリプトやブックマークレットを作って配布したいとき",
    trustRequired: true,
    trustNote:
      "security_check が Clipboard API の利用を検出するため trustRequired は true になる。ただし trust: false でも execCommand('copy') へのフォールバックでコピーできる（Chromium で確認済み）。それも失敗した場合はテキストを選択状態にして手動コピーを案内する",
    editPoints: [
      "`<!-- USERSCRIPT:START -->` 〜 `<!-- USERSCRIPT:END -->` の <script type=\"text/plain\" id=\"userscript\"> の中身を差し替える（==UserScript== ヘッダーを含める）",
      "スクリプト本体に </script> を含む場合は <\\/script> と書く",
      "@match は必要最小限にし、@grant は使う API だけを列挙する（不要なら none）",
    ],
  },
  {
    id: "chrome-extension-zip",
    title: "Chrome拡張機能 ZIP生成ページ",
    description:
      "Manifest V3 の拡張機能のファイル一式をブラウザ内で無圧縮ZIPにしてダウンロードさせるページ。外部ライブラリ不要。要求権限の一覧と導入手順も表示する",
    useWhen: "Chrome 拡張機能を作って配布したいとき（content script 中心の小規模なもの）",
    trustRequired: true,
    trustNote: "iframe の sandbox に allow-downloads が無いため、ダウンロードには trust: true が必要",
    editPoints: [
      "`<!-- EXTENSION_FILES:START -->` 〜 `<!-- EXTENSION_FILES:END -->` の <script data-path=\"...\"> を差し替え・追加する（data-path がZIP内のパス）",
      "manifest.json は type=\"application/json\"、JS・CSS 等は type=\"text/plain\" にする",
      "ファイルの中身に </script> を含む場合は <\\/script> と書く",
      "permissions / host_permissions / matches は必要最小限にする",
    ],
  },
];

export function getTemplateInfo(id: TemplateId): TemplateInfo {
  const info = TEMPLATES.find((t) => t.id === id);
  if (!info) throw new Error(`Unknown template: ${id}`);
  return info;
}

export async function loadTemplateHtml(id: TemplateId): Promise<string> {
  // id は TEMPLATE_IDS に限定されるためパストラバーサルは起きないが、念のため再確認する
  if (!TEMPLATE_IDS.includes(id)) throw new Error(`Unknown template: ${id}`);
  return readFile(path.join(process.cwd(), "src", "templates", `${id}.html`), "utf-8");
}
