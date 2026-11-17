// Text runs as a node (plan:canvas-loop-layout-text-hits.subplan, chunk C2):
// a runs text keeps its joined content and its runs over line 0's glyphs, and
// its line sits on the alphabetic baseline, so `["H"]` lands where `"H"` does
// for every valign, boxed or not, and with fit. `keepInside` keeps the runs;
// `v.bounds` and the hit walk read its box.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TextBox, TextOptions, TextRun } from "../../src/core/paint.js";
import type { Drawing, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { hitTest } from "../../src/scene/hit.js";
import type { Scene, TextNode } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

function scene(draw: (v: View) => Drawing): Scene {
  if (text === undefined) throw new Error("no text measurer");
  return new SceneRecorder({ width: 300, height: 200 }, { text }).record(draw).scene;
}

function textAt(content: string | readonly TextRun[], at: { box: TextBox; options: TextOptions }): TextNode {
  const n = scene((v) => v.text(content, at.box, at.options)).children[0];
  assert.ok(n?.kind === "text");
  return n;
}

const WATER: readonly TextRun[] = ["H", { text: "2", sub: true }, "O"];

test("runs: [\"H\"] lands where \"H\" does, unboxed, boxed and with fit", () => {
  const boxes: readonly TextBox[] = [{ x: 40, y: 80 }, { x: 20, y: 30, w: 120, h: 60 }];
  const cases = boxes.flatMap((box) => (["top", "middle", "bottom", "baseline"] as const).map((valign) => ({ box, options: { size: 24, valign } })));
  for (const at of [...cases, { box: { x: 10, y: 10, w: 8, h: 40 }, options: { size: 24, fit: true } }]) {
    const plain = textAt("H", at);
    const runs = textAt(["H"], at);
    const what = JSON.stringify(at);
    assert.deepEqual([runs.size, runs.box, runs.baselineY, runs.lines[0]?.xs], [plain.size, plain.box, plain.baselineY, plain.lines[0]?.xs], what);
    assert.equal(runs.baseline, "alphabetic", what);
    assert.equal(runs.lines[0]?.y, plain.baselineY, `the line is on the alphabetic baseline: ${what}`);
  }
});

test("runs: the node keeps the joined content and each run's glyphs, size and move", () => {
  const n = textAt(WATER, { box: { x: 40, y: 80 }, options: { size: 20, valign: "baseline" } });
  assert.equal(n.content, "H2O");
  assert.deepEqual(n.runs, [{ from: 0, to: 1, size: 20, style: "normal", dy: 0 }, { from: 1, to: 2, size: 14, style: "normal", dy: 4.4 }, { from: 2, to: 3, size: 20, style: "normal", dy: 0 }]);
  assert.equal(textAt("H2O", { box: { x: 0, y: 0 }, options: {} }).runs, undefined, "plain text has no runs");
  const red = { text: "2", fill: "red" };
  assert.throws(() => textAt(["H", red], { box: { x: 0, y: 0 }, options: {} }), /v\.text: unknown run key "fill"/);
});

test("runs: a w box aligns the one line and does not wrap", () => {
  if (text === undefined) throw new Error("no text measurer");
  const options = { size: 20, align: "center" } as const;
  const width = text.width(WATER, options);
  const n = textAt(WATER, { box: { x: 10, y: 10, w: 200 }, options });
  assert.ok(Math.abs((n.lines[0]?.xs[0] ?? 0) - (10 + (200 - width) / 2)) < 1e-9);
  const narrow = textAt(["a long formula ", { text: "2", sup: true }], { box: { x: 10, y: 10, w: 30 }, options });
  assert.equal(narrow.lines.length, 1);
});

test("runs: keepInside under an at keeps the run sizes and the box", () => {
  const formula = ["CH", { text: "3", sub: true }, "COOH"];
  const [at] = scene((v) => v.at({ translate: [280, 10] }, v.text(formula, { x: 0, y: 0 }, { size: 20, keepInside: true, name: "acid" }))).children;
  assert.ok(at?.kind === "at" && at.children[0]?.kind === "text");
  const kept = at.children[0];
  assert.ok(kept.box.x + 280 < 300 - 3.9, `moved back inside: ${kept.box.x}`);
  assert.deepEqual(kept.runs?.map((r) => r.size), [20, 14, 20]);
  assert.equal(kept.content, "CH3COOH");
  assert.equal(kept.name, "acid");
});

test("runs: v.bounds is the text's box and baseline; a click on it names it", () => {
  let got: unknown;
  const s = scene((v) => {
    const t = v.text(WATER, { x: 40, y: 80 }, { size: 28, valign: "baseline", name: "water" });
    const b = v.textBounds(WATER, { x: 40, y: 80 }, { size: 28, valign: "baseline" });
    got = [v.bounds(t), { x: b.x, y: b.y, w: b.w, h: b.h, baseline: 80 }];
    return t;
  });
  assert.ok(Array.isArray(got));
  assert.deepEqual(got[0], got[1]);
  assert.deepEqual(hitTest(s, [50, 75]).targets, ["water"]);
  assert.deepEqual(hitTest(s, [50, 120]).targets, []);
});
