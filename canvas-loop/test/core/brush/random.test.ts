import assert from "node:assert/strict";
import { test } from "node:test";
import { noise1 } from "../../../src/core/brush/random.js";

test("periodic noise wraps: the value at the period equals the value at 0", () => {
  for (const seed of [1, 99, 123456]) {
    assert.equal(noise1(seed, { channel: 1, x: 7, period: 7 }), noise1(seed, { channel: 1, x: 0, period: 7 }));
    assert.equal(noise1(seed, { channel: 1, x: 6.5, period: 7 }), noise1(seed, { channel: 1, x: -0.5, period: 7 }));
  }
});
