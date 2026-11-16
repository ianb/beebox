// Stroke preparation for the GPU sample pass (canvas-loop-gpu-brushes.subplan.md,
// "The contour contract"): the counts are resample's own, the box holds every
// sample, and the expander keeps the prepared stroke with its expansion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleSegments } from "../../src/core/brush/sample.js";
import { BrushExpander, brushSamples, prepare } from "../../src/scene/brush/expand.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { prepareContour } from "../../src/scene/brush/prepare.js";
import { resolveBrush } from "../../src/core/brush/presets.js";
import type { Contour } from "../../src/core/contours.js";
import type { Mat } from "../../src/scene/nodes.js";
import { FOCUSED_SIZE, drawFocused } from "../brushes/focused.js";
import { NO_COLORS, brushRequests } from "../brushes/requests.js";
import { goldenSamples } from "../brushes/golden.js";

test("the sample count is resample's loop, not a closed form", () => {
  assert.equal(sampleSegments([[0, 0], [2.85, 0]], 0.3).count, 11);
  assert.equal(Math.ceil(2.85 / 0.3 - 0.5) + 1, 10, "the formula the contract rejects");
  assert.equal(sampleSegments([[0, 0], [0.2, 0]], 0.3).count, 1, "shorter than one step");
  assert.equal(sampleSegments([[5, 5]], 0.3).count, 1, "one prepared point");
  assert.equal(sampleSegments([], 0.3).count, 0, "no points");
});

test("each segment's first sample is the loop's, so a sample at a corner keeps the incoming segment", () => {
  // Samples at 0, 0.3, …, 1.8 (sample 6, exactly the corner) lie on the first segment; 2.1 … 4.8 on the second.
  assert.deepEqual(sampleSegments([[0, 0], [1.8, 0], [1.8, 3]], 0.3).first, [0, 7]);
  // A segment the loop steps over gets the next sample's index, as its successor does.
  assert.deepEqual(sampleSegments([[0, 0], [1, 0], [1.05, 0], [3, 0]], 0.5).first, [0, 3, 3]);
});

test("a closed dot with wobble gets a finite sample, its wobble read at 0", () => {
  const scene = new SceneRecorder({ width: 50, height: 50 }).record((v) => v.rect(10, 10, 0.1, 0.1, { stroke: "#000", weight: 4, brush: "ink", gesture: { wobble: 1 } })).scene;
  const [req] = brushRequests(scene, NO_COLORS);
  assert.ok(req !== undefined);
  const [c] = brushSamples(req) ?? [];
  assert.equal(c?.samples.length, 1);
  const s = c?.samples[0];
  assert.ok(s !== undefined && Number.isFinite(s.x) && Number.isFinite(s.y), `got (${s?.x}, ${s?.y})`);
  assert.equal(s.x, 10, "the wobble moves along the normal (0, -1)");
  assert.notEqual(s.y, 10, "the wobble moves it");
});

test("prepared contours have the CPU sampling's counts, and the box holds every sample", () => {
  const scene = new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene;
  const reqs = brushRequests(scene, NO_COLORS);
  // The CPU samples, golden: relative to each contour's origin, in f32.
  const golden = goldenSamples("focused");
  assert.equal(golden.length, reqs.length);
  let contours = 0;
  for (const [i, req] of reqs.entries()) {
    const p = prepare(req);
    const cpu = golden[i] ?? [];
    assert.ok(p !== undefined);
    assert.deepEqual(p.contours.map((c) => c.count), cpu.map((c) => c.length));
    for (const [c, samples] of cpu.entries()) {
      const [ox, oy] = p.contours[c]?.origin ?? [NaN, NaN];
      for (const s of samples) {
        const [x, y] = [ox + s.x, oy + s.y];
        assert.ok(x >= p.box.x0 - 1e-4 && x <= p.box.x1 + 1e-4 && y >= p.box.y0 - 1e-4 && y <= p.box.y1 + 1e-4, `sample (${x}, ${y}) outside the box`);
      }
    }
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

test("a brush getter that prepares another contour does not change the outer one", () => {
  const box = (): { x0: number; y0: number; x1: number; y1: number } => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const id: Mat = [1, 0, 0, 1, 0, 0];
  const gesture = {};
  const line = (points: Contour["points"], seed: number): { contour: Contour; seed: number } => ({ contour: { points, closed: false }, seed });
  const outer = line([[0, 0], [10, 0]], 1);
  const inner = line([[100, 100], [200, 100]], 2);
  const brush = resolveBrush("pencil", undefined);
  assert.ok(brush.kind === "stamp", "pencil is a stamp brush, whose step reads its spacing");
  const plain = prepareContour(outer, { b: id, brush, gesture, width: 2, box: box() });
  const reentrant = { ...brush };
  Object.defineProperty(reentrant, "spacing", {
    get: () => (prepareContour(inner, { b: id, brush, gesture, width: 2, box: box() }), brush.spacing),
  });
  const nested = prepareContour(outer, { b: id, brush: reentrant, gesture, width: 2, box: box() });
  assert.deepEqual(nested, plain);
});
