// Text runs measured as one line (plan:canvas-loop-layout-text-hits.subplan,
// chunk C1): the width is the sum of each run's width in its own font, the box
// is the base size's line box, and runs a text cannot draw throw at the call.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TextRun } from "../../../src/core/paint.js";
import { SeededRandom } from "../../../src/core/prng.js";
import { fontString } from "../../../src/core/text/measure.js";
import type { TextMeasurer } from "../../../src/core/text/measure.js";
import { openTextMeasurer } from "../../../src/device/open.js";
import { TeaUtil } from "../../../src/headless/tea-util.js";
import type { UtilText } from "../../../src/headless/tea-util.js";
import { SceneRecorder } from "../../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});
function measurer(): TextMeasurer {
  if (text === undefined) throw new Error("no text measurer");
  return text;
}

const WATER: readonly TextRun[] = ["H", { text: "2", sub: true }, "O"];

test("runs: as wide as each run in its own font; dy moves sub down and sup up", () => {
  const m = measurer();
  const at = (size: number): string => fontString({ size, font: "sans-serif", style: "normal" });
  const want = m.measure("H", at(20)) + m.measure("2", at(14)) + m.measure("O", at(20));
  assert.ok(Math.abs(m.width(WATER, { size: 20 }) - want) < 1e-9);
  const laid = m.runs(["x", { text: "2", sup: true }, { text: "i", sub: true, style: "italic" }], { size: 20, font: "sans-serif", style: "bold" });
  assert.deepEqual(laid.runs.map((r) => [r.size, r.style, r.dy]), [[20, "bold", 0], [14, "bold", -7.6], [14, "italic", 4.4]]);
  assert.equal(laid.runs[1]?.x, laid.runs[0]?.w, "pens follow on");
});

test("runs: the box is a plain text's line box, for a point and with fit", () => {
  const v = new SceneRecorder({ width: 400, height: 200 }, { text: measurer() });
  v.record((view) => {
    const runs = view.textBounds(WATER, { x: 40, y: 80 }, { size: 28, valign: "baseline" });
    const plain = view.textBounds("HO", { x: 40, y: 80 }, { size: 28, valign: "baseline" });
    assert.deepEqual([runs.y, runs.h, runs.lines], [plain.y, plain.h, 1]);
    assert.equal(runs.w, view.textWidth(WATER, { size: 28 }));
    const fitted = view.textBounds(WATER, { x: 0, y: 0, w: 20 }, { size: 28, fit: true });
    assert.ok(fitted.size < 28 && fitted.w <= 20.01 && fitted.lines === 1, `fit shrinks every run: ${JSON.stringify(fitted)}`);
    return null;
  });
});

test("runs that a text cannot draw throw, naming the call", () => {
  const v = new SceneRecorder({ width: 100, height: 100 }, { text: measurer() });
  const m = measurer();
  const where = { transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, pixelRatio: 1, canvas: { width: 100, height: 100 } };
  const bounds: UtilText["bounds"] = (...[content, box, options]) => m.place(content, { box, options: options ?? {}, where }).bounds;
  const u = new TeaUtil({ random: new SeededRandom(1), getParams: () => ({}), onHandled: () => {}, log: () => {}, text: { width: m.width.bind(m), bounds } });
  v.record((view) => {
    assert.throws(() => view.textBounds(["a", "b\nc"], { x: 0, y: 0 }), /v\.textBounds: runs are one line/);
    assert.throws(() => view.textBounds(WATER, { x: 0, y: 0, w: 50 }, { wrap: true }), /v\.textBounds: runs are one line and do not wrap/);
    assert.throws(() => view.textWidth([{ text: "2", sub: true, sup: true }]), /v\.textWidth: a run is sub or sup, not both/);
    return null;
  });
  // A key kept in a variable passes TypeScript's excess-property check.
  const red = { text: "2", fill: "red" };
  assert.throws(() => u.textWidth([red]), /u\.textWidth: unknown run key "fill" .*one paint/);
});
