// # The gap between two commits
//
// The commit list shows the time between consecutive commits as a clock, and
// nothing when the gap is negative, over an hour, or a date does not parse.
// An invalid date must not read as a plausible "0:00".
// See `src/components/history/HistoryViewCard/commit-gap.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { commitGap } from "../../../../src/components/history/HistoryViewCard/commit-gap.js";

const BASE = "2026-11-11T10:00:00Z";

void test("commitGap is a clock up to an hour", async (t) => {
  t.check([commitGap(BASE, "2026-11-11T10:00:00Z"), commitGap(BASE, "2026-11-11T10:03:20Z"), commitGap(BASE, "2026-11-11T11:00:00Z")], ["0:00", "3:20", "1:00:00"]);
});

void test("commitGap is null for a negative, long, or unparseable gap", async (t) => {
  t.check(
    [commitGap(BASE, "2026-11-11T09:59:59Z"), commitGap(BASE, "2026-11-11T11:00:01Z"), commitGap("not a date", BASE), commitGap(BASE, "")],
    [null, null, null, null],
  );
});
