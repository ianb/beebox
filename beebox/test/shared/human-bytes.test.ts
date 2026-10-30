// # human-bytes: compact byte-size labels
//
// One formatter for every surface that shows a size. Binary units, one decimal
// below 10, none above; a trailing `.0` is dropped.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { humanBytes } from "../../src/shared/human-bytes.js";

// ## Sizes scale through the units
void test("Sizes scale through the units", async (t) => {
  t.check(humanBytes(936), "936 B");
  t.check(humanBytes(1024), "1 KB");
  t.check(humanBytes(1536), "1.5 KB");
  t.check(humanBytes(2048), "2 KB");
  t.check(humanBytes(10 * 1024), "10 KB");
  t.check(humanBytes(2_400_000), "2.3 MB");
  t.check(humanBytes(1.5 * 1024 ** 3), "1.5 GB");
});

// ## Zero, negative and non-finite values read as 0 B
void test("Zero, negative and non-finite values read as 0 B", async (t) => {
  t.check(humanBytes(0), "0 B");
  t.check(humanBytes(-5), "0 B");
  t.check(humanBytes(Number.NaN), "0 B");
  t.check(humanBytes(Number.POSITIVE_INFINITY), "0 B");
});
