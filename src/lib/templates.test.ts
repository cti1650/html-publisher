// テンプレートは AI が「お手本」としてそのまま公開する前提のため、
// 公開前チェックで止まらないことと、一覧情報の trustRequired が実際の判定と一致することを固定する。

import { describe, expect, it } from "vitest";
import { scanHtml } from "./security";
import { evaluateSecurityGate } from "./security/gate";
import { TEMPLATES, TEMPLATE_IDS, loadTemplateHtml } from "./templates";

describe("テンプレート", () => {
  it("TEMPLATE_IDS と TEMPLATES が一致する", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
  });

  for (const info of TEMPLATES) {
    describe(info.id, () => {
      it("HIGH の検出がなく confirm_security 無しで公開できる", async () => {
        const html = await loadTemplateHtml(info.id);
        const gate = evaluateSecurityGate(html);
        expect(gate.summary.summary.high).toBe(0);
        expect(gate.blocked).toBe(false);
      });

      it("trustRequired が security_check の判定と一致する", async () => {
        const html = await loadTemplateHtml(info.id);
        const report = scanHtml(html);
        expect(report.recommendation.trustRequired).toBe(info.trustRequired);
      });

      it("editPoints に書いたマーカーが本体に存在する", async () => {
        const html = await loadTemplateHtml(info.id);
        for (const point of info.editPoints) {
          for (const [, marker] of point.matchAll(/`([^`]*(?:START|END)[^`]*)`/g)) {
            expect(html).toContain(marker);
          }
        }
      });
    });
  }
});
