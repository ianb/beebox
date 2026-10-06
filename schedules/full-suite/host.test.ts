import assert from "node:assert/strict";
import test from "node:test";
import { PAGEOUT_RATE_THRASH, SWAP_FREE_FLOOR_BYTES, hostBlockers, isHostQuiet } from "../../bin/host-pressure.js";

const GB = 1024 ** 3;
const calm = { load1: 2, bar: 12, level: 1, swapFreeBytes: 8 * GB, pageoutRate: 0 };

test("a calm host with every signal present is quiet", () => {
  assert.deepEqual(hostBlockers(calm), []);
  assert.equal(isHostQuiet(calm), true);
});

test("warn pressure blocks, normal does not", () => {
  assert.deepEqual(hostBlockers({ ...calm, level: 2 }), ["memory pressure level 2"]);
  assert.equal(isHostQuiet({ ...calm, level: 4 }), false);
  assert.equal(isHostQuiet({ ...calm, level: 1 }), true);
});

test("free swap under the floor blocks; the 2026-09-25 figure (112 MB) is far under it", () => {
  assert.equal(isHostQuiet({ ...calm, swapFreeBytes: 112 * 1024 ** 2 }), false);
  assert.equal(isHostQuiet({ ...calm, swapFreeBytes: SWAP_FREE_FLOOR_BYTES - 1 }), false);
  assert.equal(isHostQuiet({ ...calm, swapFreeBytes: SWAP_FREE_FLOOR_BYTES }), true);
});

test("a pageout rate at the threshold blocks, below it does not", () => {
  assert.equal(isHostQuiet({ ...calm, pageoutRate: PAGEOUT_RATE_THRASH }), false);
  assert.equal(isHostQuiet({ ...calm, pageoutRate: PAGEOUT_RATE_THRASH - 1 }), true);
  assert.match(hostBlockers({ ...calm, pageoutRate: 500 }).join(","), /pageouts 500\/s/u);
});

test("unknown signals (non-Darwin) never block", () => {
  assert.equal(isHostQuiet({ load1: 2, bar: 12, level: null, swapFreeBytes: null, pageoutRate: null }), true);
  assert.equal(isHostQuiet({ load1: 2, bar: 12, level: null }), true);
});

test("every failing signal is named, so the log says why", () => {
  const reasons = hostBlockers({ load1: 20, bar: 12, level: 2, swapFreeBytes: GB, pageoutRate: 900 });
  assert.equal(reasons.length, 4);
});
