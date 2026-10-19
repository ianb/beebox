// # Bulk-upload concurrent-stream gate
//
// `beginStream`/`endStream` bound how many streaming uploads a single session can
// have in flight at once, and refuse a second concurrent stream for the same item —
// a cheap guard against a client opening dozens of parallel streams that each pass
// the pre-commit byte check and jointly overshoot the staging cap.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { beginStream, endStream } from "../../../../src/webapp/routes/bulk-upload/stream-gate.js";

// ## A second concurrent stream for the same item is refused
void test("A second concurrent stream for the same item is refused", async (t) => {
  t.teardown(async () => {
    try {
      endStream("s1", "item-a");
    } catch (error) {
      t.error(error);
    }
  });
  const first = beginStream("s1", "item-a");
  const again = beginStream("s1", "item-a");
  t.check({ first, again }, {
    first: "ok",
    again: "duplicate",
  });

  // Releasing the slot lets the same item stream again (a genuine retry after the
  // first finished):

  endStream("s1", "item-a");
  t.check(beginStream("s1", "item-a"), "ok");
});

// ## The per-session concurrent-stream cap (8) refuses the 9th
//
// Eight distinct items can stream at once; a ninth is refused until one releases:
void test("Eight distinct items can stream at once; a ninth is refused until one releases:", async (t) => {
  t.teardown(async () => {
    try {
      for (let i = 1; i < 9; i++) endStream("s2", `item-${String(i)}`);
    } catch (error) {
      t.error(error);
    }
  });
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push(beginStream("s2", `item-${String(i)}`));
  t.check({ firstEight: codes.slice(0, 8), ninth: codes[8] }, {
    firstEight: [
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ],
    ninth: "too-many",
  });

  // Releasing one frees exactly one slot:

  endStream("s2", "item-0");
  const afterRelease = beginStream("s2", "item-8");
  t.check({ afterRelease }, {
    afterRelease: "ok",
  });
});

// ## Sessions are counted independently
//
// A second session has its own budget — one session's in-flight streams don't
// count against another's:
void test("A second session has its own budget — one session's in-flight streams don't c...", async (t) => {
  t.teardown(async () => {
    try {
      endStream("s3", "x");
      endStream("s4", "x");
    } catch (error) {
      t.error(error);
    }
  });
  beginStream("s3", "x");
  const otherSession = beginStream("s4", "x");
  t.check({ otherSession }, {
    otherSession: "ok",
  });
});
