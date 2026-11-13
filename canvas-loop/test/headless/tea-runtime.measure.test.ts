import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { TextBounds, TextBox, TextOptions } from "../../src/core/paint.js";
import type { Util, View } from "../../src/core/tea.js";
import { teaRunOptions, tmpDir } from "../helpers.js";

// One wrapped label, one near the right edge with keepInside, one in a fitted box.
const CASES: readonly (readonly [string, TextBox, TextOptions])[] = [
  ["Calcium hydroxide reacts with carbon dioxide", { x: 10, y: 10, w: 90 }, { size: 14 }],
  ["Ca(OH)2", { x: 196, y: 40 }, { size: 16, keepInside: true }],
  ["mass of the products", { x: 20, y: 70, w: 60, h: 20 }, { size: 18, fit: true, halo: "#ffffff" }],
];

test("u.textBounds in update gives what v.text then draws, and u.textWidth what v.textWidth gives", () => {
  const measured: { update: TextBounds[]; draw: TextBounds[]; widths: [number, number] } = { update: [], draw: [], widths: [0, 0] };
  const sketch = toTeaModule({
    canvas: { width: 200, height: 120 },
    init: (u: Util) => {
      measured.update = CASES.map(([s, box, options]) => u.textBounds(s, box, options));
      measured.widths[0] = u.textWidth("Ca(OH)2", { size: 16, style: "bold" });
      return {};
    },
    update: (model: object) => model,
    draw: (v: View) => {
      measured.draw = CASES.map(([s, box, options]) => v.text(s, box, options));
      measured.widths[1] = v.textWidth("Ca(OH)2", { size: 16, style: "bold" });
    },
  });
  teaRun(teaRunOptions(sketch, { outDir: tmpDir(), frames: 1, every: 1 }));
  assert.deepEqual(measured.update, measured.draw);
  assert.equal(measured.widths[0], measured.widths[1]);
  assert.ok(measured.widths[0] > 30, `a real width: ${measured.widths[0]}`);
  assert.ok((measured.update[0]?.lines ?? 0) > 1, "the long label wraps");
  const kept = measured.update[1];
  assert.ok(kept !== undefined && kept.x + kept.w <= 196, `keepInside moved the label in: ${JSON.stringify(kept)}`);
});
