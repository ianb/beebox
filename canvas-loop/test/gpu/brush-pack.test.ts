// The brush pass's batch planner (canvas-loop-gpu-brushes.subplan.md, chunk 5),
// without a GPU: spans that may split fill each batch to its cap; whole spans
// (bristle and smear, when they move to the GPU) never split; a whole span
// over the cap is an error.
import assert from "node:assert/strict";
import { test } from "node:test";
import { planBatches } from "../../src/gpu/brush-pack.js";
import { GpuRenderError } from "../../src/scene/errors.js";

test("spans that may split fill each batch to its cap, across contour boundaries", () => {
  const spans = [{ first: 0, count: 5, whole: false }, { first: 5, count: 1, whole: false }, { first: 6, count: 7, whole: false }];
  assert.deepEqual(planBatches(spans, 4), [{ first: 0, count: 4 }, { first: 4, count: 4 }, { first: 8, count: 4 }, { first: 12, count: 1 }]);
  assert.deepEqual(planBatches(spans, 100), [{ first: 0, count: 13 }]);
});

test("a whole span goes into one batch, starting a new one when it does not fit", () => {
  const spans = [{ first: 10, count: 3, whole: true }, { first: 13, count: 3, whole: true }, { first: 16, count: 5, whole: false }, { first: 21, count: 4, whole: true }];
  assert.deepEqual(planBatches(spans, 4), [{ first: 10, count: 3 }, { first: 13, count: 4 }, { first: 17, count: 4 }, { first: 21, count: 4 }]);
});

test("a whole span over the cap is an error", () => {
  assert.throws(() => planBatches([{ first: 0, count: 5, whole: true }], 4), GpuRenderError);
});
