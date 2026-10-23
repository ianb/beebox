// # The Properties "Changed" line
//
// A card's Properties face names its newest commit as "<how long ago> ·
// <subject>", with the commit's full date as the tooltip. It reuses
// `formatAgo` (`lib/relative-time.ts`); the caller passes `now`, so the line
// is deterministic.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { lastChangeLine } from "../../src/lib/last-change-line.js";

const now = Date.parse("2026-10-06T12:00:00Z");

void test("line 14", async (t) => {
  t.check(lastChangeLine({ date: "2026-10-03T09:30:00Z", subject: "Add porch quotes" }, now), {
    text: "3d ago · Add porch quotes",
    title: "2026-10-03T09:30:00Z",
  });
});

// From a week on the line gives the date, with the year when it differs:
void test("A commit a week or more old shows its date.", async (t) => {
  const local = (y: number, d: number) => new Date(y, 8, d, 12).toISOString();
  t.check(
    [lastChangeLine({ date: local(2026, 15), subject: "Old" }, now).text,
     lastChangeLine({ date: local(2025, 15), subject: "Older" }, now).text],
    ["Sep 15 · Old", "Sep 15, 2025 · Older"],
  );
});

// A commit seconds old reads "just now", and so does a commit dated slightly
// ahead of this clock (another machine's clock skew):
void test("A commit seconds old reads \"just now\", and so does a commit dated slightly ah...", async (t) => {
  t.check(
    [lastChangeLine({ date: "2026-10-06T11:59:50Z", subject: "Fix typo" }, now).text,
     lastChangeLine({ date: "2026-10-06T12:01:00Z", subject: "Fix typo" }, now).text],
    [
    "just now · Fix typo",
    "just now · Fix typo",
  ],
  );
});

// A date that does not parse is shown as written rather than as "NaN days ago",
// and so is any date before the component has read the clock (`useNow` starts
// at zero to keep render pure):
void test("A date that does not parse is shown as written rather than as \"NaN days ago\",...", async (t) => {
  t.check(
    [lastChangeLine({ date: "yesterday-ish", subject: "Import" }, now).text,
     lastChangeLine({ date: "2026-10-03T09:30:00Z", subject: "Import" }, null).text],
    [
    "yesterday-ish · Import",
    "2026-10-03T09:30:00Z · Import",
  ],
  );
});
