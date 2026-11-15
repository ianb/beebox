// Stroke preparation for the GPU sample pass (canvas-loop-gpu-brushes.subplan.md,
// "The contour contract"): the counts are resample's own, the box holds every
// sample, and the expander keeps the prepared stroke with its expansion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleCount } from "../../src/core/brush/sample.js";
import { BrushExpander, brushSamples, prepare } from "../../src/scene/brush/expand.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { FOCUSED_SIZE, drawFocused } from "../brushes/focused.js";
import { NO_COLORS, brushRequests } from "../brushes/requests.js";

test("the sample count is resample's loop, not a closed form", () => {
  assert.equal(sampleCount(2.85, 0.3, 2), 11);
  assert.equal(Math.ceil(2.85 / 0.3 - 0.5) + 1, 10, "the formula the contract rejects");
  assert.equal(sampleCount(0.2, 0.3, 2), 1, "shorter than one step");
  assert.equal(sampleCount(5, 0.3, 1), 1, "one prepared point");
});

test("prepared contours have the CPU sampling's counts, and the box holds every sample", () => {
  const scene = new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene;
  let contours = 0;
  for (const req of brushRequests(scene, NO_COLORS)) {
    const p = prepare(req);
    const cpu = brushSamples(req);
    assert.ok(p !== undefined && cpu !== undefined);
    assert.deepEqual(p.contours.map((c) => c.count), cpu.map((c) => c.samples.length));
    for (const s of cpu.flatMap((c) => c.samples)) assert.ok(s.x >= p.box.x0 && s.x <= p.box.x1 && s.y >= p.box.y0 && s.y <= p.box.y1, `sample (${s.x}, ${s.y}) outside the box`);
    contours += cpu.length;
  }
  assert.ok(contours >= 17);
});

test("the expander prepares a stroke once and keeps it with the expansion", () => {
  const [req] = brushRequests(new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene, NO_COLORS);
  assert.ok(req !== undefined);
  const ex = new BrushExpander();
  ex.beginFrame();
  const first = ex.expand(req)?.prepared();
  ex.beginFrame();
  const again = ex.expand(req);
  assert.equal(ex.stats.hits, 1);
  assert.ok(first !== undefined && again?.prepared() === first, "a cache hit returns the same prepared stroke");
  assert.deepEqual(first, prepare(req));
});
