// # Connector activity verdict
//
// `connectorVerdict` decides from a connector's activity record whether it has
// gone quiet or keeps failing. A false alarm on a real box is worse than
// silence, so every rule below errs toward saying nothing.
//
// Histories here are written one character per box-local day, oldest first,
// ending on `today`:
//
// - `P` — synced successfully and brought in new items
// - `Z` — synced successfully, nothing new
// - `E` — every sync that day errored
// - `S` — every sync that day was skipped (service off, no credential)
// - `.` — no sync ran that day

import { test } from "tap";
import "agent-doctest/tap";
import { is } from "agent-doctest/check";
import { connectorVerdict, nextEpisode, describeVerdict } from "../src/connector-activity/verdict.js";
import { addDays } from "../src/connector-activity/core.js";
import type { ConnectorDay, ConnectorEpisode } from "../src/connector-activity/core.js";
import assert from "node:assert/strict";

const today = "2026-09-18";

/** Days ending on `end` (default `today`). */
function history(pattern: string, end?: string) {
  const days: Record<string, ConnectorDay> = {};
  const chars = [...pattern];
  for (const [i, char] of chars.entries()) {
    const day = addDays(end ?? today, i - (chars.length - 1));
    const base = { runs: 1, ok: 0, newItems: 0, created: 0, updated: 0, errored: 0, skipped: 0, lastError: null };
    if (char === "P") days[day] = { ...base, ok: 1, newItems: 12, created: 30 };
    if (char === "Z") days[day] = { ...base, ok: 1, updated: 3 };
    if (char === "E") days[day] = { ...base, errored: 1, lastError: "invalid_grant" };
    if (char === "S") days[day] = { ...base, skipped: 1 };
  }
  return days;
}

function verdict(pattern: string, openEpisode?: ConnectorEpisode | null) {
  return connectorVerdict({ days: history(pattern), today, openEpisode: openEpisode ?? null });
}

const daily = "P".repeat(35);

// ## The anchor incident: a daily producer stops bringing in new items
//
// Five weeks of new mail every day, then syncs keep succeeding (refreshing tracked
// threads) with nothing new. Two quiet days are allowed; the third alerts.
void test("Five weeks of new mail every day, then syncs keep succeeding (refreshing trac...", async (t) => {
  // doctest:L55
  t.check(verdict(daily + "ZZ"), { kind: "healthy" });

  // doctest:L58
  t.check(verdict(daily + "ZZZ"), { kind: "quiet", since: "2026-09-16", quietDays: 3, allowedDays: 2 });
});

// ## Days with no syncs count for nothing
//
// A scheduler outage in the middle of a quiet stretch neither extends it nor
// breaks it. A week off followed by one quiet day is one quiet day:
void test("A scheduler outage in the middle of a quiet stretch neither extends it nor br...", async (t) => {
  // doctest:L68
  t.check(verdict(daily + ".......Z"), { kind: "healthy" });

  // doctest:L71
  t.check(verdict(daily + "Z.......ZZ"), { kind: "quiet", since: "2026-09-09", quietDays: 3, allowedDays: 2 });
});

// ## Sparse and irregular connectors are never watched
//
// New items on fewer than 60% of the 28 calendar days before the quiet stretch
// means the connector is not a steady producer. A Monday/Wednesday/Friday
// connector produces on at most 12 of 28 days, however regular it is:
void test("New items on fewer than 60% of the 28 calendar days before the quiet stretch...", async (t) => {
  // doctest:L82
  t.check(verdict("P.P.P..".repeat(5) + "Z.Z.Z..Z.Z.Z.."), { kind: "unwatched" });

  // doctest:L85
  t.check(verdict("PZZZZZZ".repeat(5) + "ZZZZZZZZZZZZZZ"), { kind: "unwatched" });
});

// Nor is a connector with under 21 days of history:
void test("Nor is a connector with under 21 days of history:", async (t) => {
  // doctest:L92
  t.check(verdict("P".repeat(15) + "ZZZZZ"), { kind: "unwatched" });
});

// ## A connector with gaps gets a longer allowance
//
// The allowance is twice the longest quiet run in the baseline. A connector that
// routinely skips two days at a time may be quiet for four:
void test("The allowance is twice the longest quiet run in the baseline.", async (t) => {
  // doctest:L102
  const gappy = "ZZPPPPP".repeat(5);
  t.check(verdict(gappy + "ZZZZ"), { kind: "healthy" });

  // doctest:L106
  t.check(verdict(gappy + "ZZZZZ"), { kind: "quiet", since: "2026-09-14", quietDays: 5, allowedDays: 4 });
});

// ## Errors and skips are not quiet days
//
// A day whose syncs all errored or skipped is passed over by the quiet count.
// Errors have their own verdict; a skip already says why nothing ran.
void test("A day whose syncs all errored or skipped is passed over by the quiet count.", async (t) => {
  // doctest:L116
  t.check(verdict(daily + "ZSSSSZ"), { kind: "healthy" });

  // doctest:L119
  t.check(verdict(daily + "ZE"), { kind: "healthy" });

  // doctest:L122
  t.check(verdict(daily + "ZEE"), { kind: "failing", since: "2026-09-17", failingDays: 2, lastError: "invalid_grant" });
});

// A connector that fails every sync for two run days is failing, whatever its
// history, and an ok day ends it:
void test("A connector that fails every sync for two run days is failing, whatever its h...", async (t) => {
  // doctest:L130
  t.check(verdict("EE"), { kind: "failing", since: "2026-09-17", failingDays: 2, lastError: "invalid_grant" });

  // doctest:L133
  t.check(verdict("E.....E"), { kind: "failing", since: "2026-09-12", failingDays: 2, lastError: "invalid_grant" });

  // doctest:L136
  t.check(verdict("EEEP"), { kind: "healthy" });
});

// ## An open episode does not age out
//
// Two months into a quiet stretch, the baseline has left the 60-day record. With
// no open episode the connector would read as unwatched and its warning would
// vanish on its own. The stored episode keeps it quiet until new items arrive:
void test("Two months into a quiet stretch, the baseline has left the 60-day record.", async (t) => {
  // doctest:L147
  const longQuiet = "Z".repeat(60);
  t.check(verdict(longQuiet), { kind: "unwatched" });

  // doctest:L151
  t.check(verdict(longQuiet, { kind: "quiet", since: "2026-06-01", notifiedAt: null, dismissedAt: null }), { kind: "quiet", since: "2026-06-01", quietDays: 60, allowedDays: null });

  // doctest:L154
  t.check(verdict(longQuiet + "P", { kind: "quiet", since: "2026-06-01", notifiedAt: null, dismissedAt: null }), { kind: "healthy" });
});

// ## Episodes persist their notification and dismissal
//
// `nextEpisode` keeps the stored episode while the same one continues, so a sent
// notification is not sent again and a dismissal sticks. A cleared condition
// drops it, and the next episode starts fresh.
void test("nextEpisode keeps the stored episode while the same one continues, so a sent...", async (t) => {
  // doctest:L165
  const quiet = connectorVerdict({ days: history(daily + "ZZZ"), today, openEpisode: null });
  const first = nextEpisode(null, quiet);
  assert.ok(first);
  t.check(first, {
    kind: "quiet",
    since: "2026-09-16",
    notifiedAt: null,
    dismissedAt: null,
  });

  // doctest:L171
  const dismissed = { ...first, notifiedAt: "2026-09-18T12:00:00.000Z", dismissedAt: "2026-09-18T13:00:00.000Z" };
  // The next day: same history plus one more quiet day.
  const tomorrow = addDays(today, 1);
  const longer = connectorVerdict({ days: history(daily + "ZZZZ", tomorrow), today: tomorrow, openEpisode: dismissed });
  t.check(nextEpisode(dismissed, longer), is(dismissed));

  // doctest:L178
  t.check(nextEpisode(dismissed, { kind: "healthy" }), null);

  // ## The message names the connector and what to look at

  // doctest:L185
  t.check(describeVerdict("gmail", quiet), "gmail has brought in nothing new on its last 3 days of syncing since 2026-09-16 (more than 2 days without something new is unusual for it). Syncs are still succeeding, so check whether a filter, permission or upstream change stopped it.");

  // doctest:L188
  t.check(describeVerdict("gmail", connectorVerdict({ days: history("PEE"), today, openEpisode: null })), "gmail has failed every sync on its last 2 days of running, since 2026-09-17: invalid_grant");
});
