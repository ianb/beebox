// The measurer's baseline gap (plan:canvas-loop-layout-text-hits.subplan, chunk A1):
// how far below a Canvas2D `textBaseline` line the alphabetic baseline sits.
// Canvas reports `alphabeticBaseline` with up as positive; this pins that sign
// for the headless runtime, so a baseline row does not turn upside down.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fontString } from "../../../src/core/text/measure.js";
import { openTextMeasurer } from "../../../src/device/open.js";

test("baselineGap: below top and middle, zero at alphabetic, above bottom", async () => {
  const m = await openTextMeasurer();
  const font = fontString({ size: 24, font: "sans-serif", style: "normal" });
  const top = m.baselineGap(font, "top");
  const middle = m.baselineGap(font, "middle");
  assert.equal(m.baselineGap(font, "alphabetic"), 0);
  assert.ok(top > 12 && top < 24, `from top: ${top}`);
  assert.ok(middle > 0 && middle < top, `from middle: ${middle}`);
  assert.ok(m.baselineGap(font, "bottom") < 0, "the bottom line is below the baseline");
  assert.equal(m.baselineGap(font, "top"), top, "cached");
});
