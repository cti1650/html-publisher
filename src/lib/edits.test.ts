// 差分適用の回帰テスト。
// 「意図しない箇所を書き換えない」ことが最優先のため、一致の判定と適用順序の規則を固定する。

import { describe, expect, it } from "vitest";
import { EditError, applyEdits } from "./edits";

const HTML = [
  "<!DOCTYPE html>",
  "<html>",
  "  <head>",
  "    <title>経費精算</title>",
  "  </head>",
  "  <body>",
  "    <h1>経費精算</h1>",
  '    <button class="btn">保存</button>',
  '    <button class="btn">取消</button>',
  "  </body>",
  "</html>",
].join("\n");

describe("applyEdits: 適用", () => {
  it("1か所に一致する old_text を置き換える", () => {
    const { html } = applyEdits(HTML, [{ old_text: "<h1>経費精算</h1>", new_text: "<h1>交通費申請</h1>" }]);
    expect(html).toContain("<h1>交通費申請</h1>");
    // 同じ文字列を含む <title> は書き換わらない
    expect(html).toContain("<title>経費精算</title>");
  });

  it("複数の書き換えを順不同で指定できる", () => {
    const { html } = applyEdits(HTML, [
      { old_text: ">取消<", new_text: ">キャンセル<" },
      { old_text: "<title>経費精算</title>", new_text: "<title>交通費申請</title>" },
    ]);
    expect(html).toContain("<title>交通費申請</title>");
    expect(html).toContain(">キャンセル<");
  });

  it("すべての old_text を元のHTMLに対して照合する（前の書き換え結果には照合しない）", () => {
    // edits[0] の new_text に edits[1] の old_text と同じ文字列が含まれていても、
    // edits[1] は元のHTMLの1か所にだけ当たる
    const { html } = applyEdits(HTML, [
      { old_text: "<h1>経費精算</h1>", new_text: "<h1>経費精算</h1>\n    <p>保存</p>" },
      { old_text: ">保存<", new_text: ">登録<" },
    ]);
    expect(html).toContain("<p>保存</p>");
    expect(html).toContain(">登録</button>");
  });

  it("new_text 内の $& や $1 を置換パターンとして解釈しない", () => {
    const { html } = applyEdits(HTML, [{ old_text: ">保存<", new_text: ">$& $1 $$<" }]);
    expect(html).toContain('<button class="btn">$& $1 $$</button>');
  });

  it("隣接しているが重ならない書き換えは許可する", () => {
    const { html } = applyEdits("abcdef", [
      { old_text: "abc", new_text: "1" },
      { old_text: "def", new_text: "2" },
    ]);
    expect(html).toBe("12");
  });

  it("new_text を空にすると削除になる", () => {
    const { html } = applyEdits(HTML, [{ old_text: '\n    <button class="btn">取消</button>', new_text: "" }]);
    expect(html).not.toContain("取消");
  });
});

describe("applyEdits: 意図しない書き換えの防止", () => {
  it("old_text が見つからなければエラー", () => {
    expect(() => applyEdits(HTML, [{ old_text: "<h2>", new_text: "x" }])).toThrow(/edits\[0\]: old_text が見つかりません/);
  });

  it("空白・インデントが違えば一致しない（曖昧な照合をしない）", () => {
    expect(() => applyEdits(HTML, [{ old_text: "  <h1>経費精算</h1>", new_text: "x" }])).not.toThrow();
    expect(() => applyEdits(HTML, [{ old_text: "<h1> 経費精算</h1>", new_text: "x" }])).toThrow(EditError);
  });

  it("old_text が複数か所に一致したらエラーにし、件数を伝える", () => {
    expect(() => applyEdits(HTML, [{ old_text: '<button class="btn">', new_text: "x" }])).toThrow(
      /edits\[0\]: old_text が2か所に一致しました/
    );
  });

  it("重なり合う一致も複数として扱う", () => {
    expect(() => applyEdits("aaa", [{ old_text: "aa", new_text: "b" }])).toThrow(/2か所に一致/);
  });

  it("前後の文脈を足して1か所に絞れば通る", () => {
    const { html } = applyEdits(HTML, [{ old_text: '<button class="btn">取消', new_text: '<button class="btn danger">取消' }]);
    expect(html).toContain('<button class="btn danger">取消</button>');
    expect(html).toContain('<button class="btn">保存</button>');
  });

  it("書き換え範囲が重なったらエラー", () => {
    expect(() =>
      applyEdits(HTML, [
        { old_text: "<h1>経費精算</h1>", new_text: "x" },
        { old_text: "経費精算</h1>\n    <button", new_text: "y" },
      ])
    ).toThrow(/edits\[0\] と edits\[1\] の書き換え範囲が重なっています/);
  });

  it("1つでもエラーがあれば何も適用しない（2つ目のエラーで1つ目も反映されない）", () => {
    const original = HTML;
    expect(() =>
      applyEdits(original, [
        { old_text: "<h1>経費精算</h1>", new_text: "<h1>交通費申請</h1>" },
        { old_text: "存在しない", new_text: "x" },
      ])
    ).toThrow(/edits\[1\]/);
    expect(original).toBe(HTML);
  });

  it("edits が空・old_text が空ならエラー", () => {
    expect(() => applyEdits(HTML, [])).toThrow(EditError);
    expect(() => applyEdits(HTML, [{ old_text: "", new_text: "x" }])).toThrow(/old_text が空です/);
  });
});

describe("applyEdits: 応答の差分", () => {
  it("edits の順番・元のHTMLでの行番号・前後2行の文脈を返す", () => {
    const { changes } = applyEdits(HTML, [
      { old_text: ">取消<", new_text: ">キャンセル<" },
      { old_text: "<h1>経費精算</h1>", new_text: "<h1>交通費申請</h1>" },
    ]);
    expect(changes.map((c) => [c.edit, c.line])).toEqual([
      [1, 9],
      [2, 7],
    ]);
    expect(changes[1].diff).toBe(
      [
        "  5 |   </head>",
        "  6 |   <body>",
        "- 7 |     <h1>経費精算</h1>",
        "+ 7 |     <h1>交通費申請</h1>",
        '  8 |     <button class="btn">保存</button>',
        '  9 |     <button class="btn">取消</button>',
      ].join("\n")
    );
  });

  it("複数行の書き換えは行ごとに表示する", () => {
    const { changes } = applyEdits(HTML, [
      { old_text: "<h1>経費精算</h1>", new_text: "<h1>交通費申請</h1>\n    <p>説明</p>" },
    ]);
    expect(changes[0].diff).toContain("- 7 |     <h1>経費精算</h1>\n+ 7 |     <h1>交通費申請</h1>\n+ 8 |     <p>説明</p>");
  });

  it("old_text が改行で終わっても次の行を書き換え範囲に含めない", () => {
    const { changes } = applyEdits(HTML, [{ old_text: "    <h1>経費精算</h1>\n", new_text: "    <h1>交通費</h1>\n" }]);
    const lines = changes[0].diff.split("\n");
    expect(lines.filter((l) => l.startsWith("-"))).toEqual(["- 7 |     <h1>経費精算</h1>"]);
    expect(lines.filter((l) => l.startsWith("+"))).toEqual(["+ 7 |     <h1>交通費</h1>"]);
    expect(lines).toContain('  8 |     <button class="btn">保存</button>');
  });

  it("先頭行・最終行でも文脈の範囲外を参照しない", () => {
    const first = applyEdits(HTML, [{ old_text: "<!DOCTYPE html>", new_text: "<!doctype html>" }]).changes[0];
    expect(first.diff.split("\n")[0]).toBe("- 1 | <!DOCTYPE html>");
    const last = applyEdits(HTML, [{ old_text: "</html>", new_text: "</html>\n" }]).changes[0];
    expect(last.line).toBe(11);
  });

  it("長い書き換えは行数の上限で省略する", () => {
    const big = Array.from({ length: 30 }, (_, i) => `    <p>${i}</p>`).join("\n");
    const { changes } = applyEdits(HTML, [{ old_text: "    <h1>経費精算</h1>", new_text: big }]);
    const plus = changes[0].diff.split("\n").filter((l) => l.startsWith("+"));
    expect(plus).toHaveLength(13);
    expect(plus.at(-1)).toBe("+ …（18行省略）");
  });
});
