import assert from "node:assert/strict";
import { test } from "node:test";
import { diskHealthFromBytes } from "./disk-health.js";

void test("disk health uses 10% of capacity with a 2 GiB floor", () => {
  const largeThreshold = 7.5 * 1024 ** 3;
  assert.equal(diskHealthFromBytes(largeThreshold, 75 * 1024 ** 3).status, "ok");
  const low = diskHealthFromBytes(largeThreshold - 1, 75 * 1024 ** 3);
  assert.equal(low.status, "low");
  assert.equal(low.thresholdGiB, 7.5);
  assert.equal(diskHealthFromBytes(1.9 * 1024 ** 3, 10 * 1024 ** 3).thresholdGiB, 2);
});
