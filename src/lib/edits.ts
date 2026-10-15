// HTML への差分適用（検索・置換方式）。
//
// AI が HTML 全文を出力し直さずに、変更箇所だけを送ってツールを作成・更新するための仕組み。
// 意図しない箇所を書き換えないよう、次のルールにしている（edits.test.ts で固定）。
// - old_text はすべて「元の HTML」に対して照合する（前の書き換え結果には照合しない）
// - 完全一致のみ。空白の違いを無視するような照合はしない
// - 各 old_text はちょうど1か所に一致しなければならない
// - 書き換え範囲が重なる場合はエラー
// - 1つでもエラーがあれば何も適用しない（例外を投げる）

export interface HtmlEdit {
  old_text: string;
  new_text: string;
}

export interface EditChange {
  /** edits の何番目か（1始まり） */
  edit: number;
  /** 元の HTML での書き換え開始行（1始まり） */
  line: number;
  /** 書き換え前後と前後の文脈。行番号は元の HTML のもの */
  diff: string;
}

export interface ApplyEditsResult {
  html: string;
  changes: EditChange[];
}

export class EditError extends Error {}

const CONTEXT_LINES = 2;
/** 1つの書き換えで差分に表示する行数の上限（書き換え前・後それぞれ） */
const MAX_DIFF_LINES = 12;

interface Match {
  edit: number;
  start: number;
  end: number;
  newText: string;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  // 重なりを含めて数える（"aa" は "aaa" に2か所一致するとみなし、曖昧として扱う）
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) count++;
  return count;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function clip(lines: string[], marker: string, startLine: number): string[] {
  const shown = lines.slice(0, MAX_DIFF_LINES).map((text, i) => `${marker} ${startLine + i} | ${text}`);
  if (lines.length > MAX_DIFF_LINES) shown.push(`${marker} …（${lines.length - MAX_DIFF_LINES}行省略）`);
  return shown;
}

function buildDiff(original: string, match: Match): { line: number; diff: string } {
  const lines = original.split("\n");
  const firstLine = lineNumberAt(original, match.start);
  // old_text は空にならないため end - 1 が一致範囲の最後の文字
  const lastLine = lineNumberAt(original, match.end - 1);

  // 一致範囲を含む行全体を、書き換え前と書き換え後で並べる。
  // old_text が改行で終わる場合も、次の行を一致範囲に含めないよう end - 1 から行末を探す
  const lineStart = original.lastIndexOf("\n", match.start - 1) + 1;
  const nextNewline = original.indexOf("\n", match.end - 1);
  const lineEnd = nextNewline === -1 ? original.length : nextNewline;
  const before = original.slice(lineStart, lineEnd).split("\n");
  // end > lineEnd（old_text が改行で終わる）のときは slice が空文字を返す
  let afterText = original.slice(lineStart, match.start) + match.newText + original.slice(match.end, lineEnd);
  if (match.end > lineEnd && afterText.endsWith("\n")) afterText = afterText.slice(0, -1);
  const after = afterText.split("\n");

  const contextBefore = lines
    .slice(Math.max(0, firstLine - 1 - CONTEXT_LINES), firstLine - 1)
    .map((text, i, arr) => `  ${firstLine - arr.length + i} | ${text}`);
  const contextAfter = lines
    .slice(lastLine, lastLine + CONTEXT_LINES)
    .map((text, i) => `  ${lastLine + 1 + i} | ${text}`);

  return {
    line: firstLine,
    diff: [...contextBefore, ...clip(before, "-", firstLine), ...clip(after, "+", firstLine), ...contextAfter].join(
      "\n"
    ),
  };
}

export function applyEdits(original: string, edits: HtmlEdit[]): ApplyEditsResult {
  if (edits.length === 0) throw new EditError("edits が空です");

  const matches: Match[] = edits.map((edit, i) => {
    const label = `edits[${i}]`;
    if (edit.old_text.length === 0) throw new EditError(`${label}: old_text が空です`);

    const count = countOccurrences(original, edit.old_text);
    if (count === 0) {
      throw new EditError(
        `${label}: old_text が見つかりません。get_tool で取得した保存済みのHTMLから、空白・改行・インデントを含めて正確に写してください`
      );
    }
    if (count > 1) {
      throw new EditError(
        `${label}: old_text が${count}か所に一致しました。前後の文脈を含めて、1か所に絞れるようにしてください`
      );
    }
    const start = original.indexOf(edit.old_text);
    return { edit: i + 1, start, end: start + edit.old_text.length, newText: edit.new_text };
  });

  const ordered = [...matches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end) {
      throw new EditError(
        `edits[${ordered[i - 1].edit - 1}] と edits[${ordered[i].edit - 1}] の書き換え範囲が重なっています。1つの書き換えにまとめてください`
      );
    }
  }

  // 後ろから適用すれば、前方の位置がずれない。String.replace は使わない（new_text 内の $& 等が解釈されるため）
  let html = original;
  for (const match of [...ordered].reverse()) {
    html = html.slice(0, match.start) + match.newText + html.slice(match.end);
  }

  const changes = matches.map((match) => ({ edit: match.edit, ...buildDiff(original, match) }));
  return { html, changes };
}
