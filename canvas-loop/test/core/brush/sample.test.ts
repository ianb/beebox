import assert from "node:assert/strict";
import { test } from "node:test";
import { resample } from "../../../src/core/brush/sample.js";

test("resampling keeps fixed spacing from the start and ends on the last point", () => {
  const samples = resample(
    [
      [0, 0],
      [10.5, 0],
    ],
    { closed: false, step: 2 },
  );
  assert.deepEqual(
    samples.map((s) => s.x),
    [0, 2, 4, 6, 8, 10.5],
  );
});
