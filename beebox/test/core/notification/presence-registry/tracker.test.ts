// # Presence tracker: tabs heard from in the last 90 seconds
//
// The server counts, per box, the web tabs that sent a heartbeat in the last 90
// seconds, and says when `.beebox/presence.json` needs writing: when the count
// changes, including one write when it drops to zero, and every 30 seconds while
// it is nonzero, so a reader never sees a live count go stale.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createPresenceTracker } from "../../../../src/core/notification/presence-registry/tracker.js";
import type { PresenceTracker } from "../../../../src/core/notification/presence-registry/tracker.js";

const T0 = Date.parse("2026-09-26T12:00:00Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

// Take whatever write is due and record it, as the server does.
function flush(tracker: PresenceTracker, seconds: number) {
  const due = tracker.due(at(seconds));
  if (due !== null) tracker.written({ activeWeb: due, now: at(seconds) });
  return due === null ? "no write" : `write ${due}`;
}

// ## Nobody has sent a heartbeat: nothing to write
void test("Nobody has sent a heartbeat: nothing to write", async (t) => {
  // doctest:L26
  const tracker = createPresenceTracker();
  t.check(flush(tracker, 0), "no write");

  // ## Two tabs count as two; a repeat heartbeat from one tab does not add

  // doctest:L34
  tracker.heard("tab-aaaaaaaa", at(0));
  t.check(flush(tracker, 0), "write 1");

  // doctest:L38
  tracker.heard("tab-bbbbbbbb", at(5));
  tracker.heard("tab-aaaaaaaa", at(10));
  t.check(tracker.count(at(10)), 2);

  // doctest:L43
  t.check(flush(tracker, 10), "write 2");

  // ## An unchanged count is rewritten every 30 seconds, not on every heartbeat

  // doctest:L50
  tracker.heard("tab-aaaaaaaa", at(20));
  t.check(flush(tracker, 20), "no write");

  // doctest:L54
  tracker.heard("tab-aaaaaaaa", at(40));
  t.check(flush(tracker, 40), "write 2");

  // ## A tab not heard from for 90 seconds expires
  //
  // Tab b last spoke at 5 s, so at 96 s only tab a (last heard at 40 s) remains.
  // When tab a also lapses, zero is written once and then nothing more.

  // doctest:L65
  t.check(tracker.count(at(95)), 2);

  // doctest:L68
  t.check(flush(tracker, 96), "write 1");

  // doctest:L71
  t.check(flush(tracker, 131), "write 0");

  // doctest:L74
  t.check(flush(tracker, 200), "no write");
});

// ## The session map is bounded
//
// A client chooses its own id, so a flood of ids drops the oldest past 64.
void test("A client chooses its own id, so a flood of ids drops the oldest past 64.", async (t) => {
  // doctest:L83
  const flooded = createPresenceTracker();
  for (let i = 0; i < 100; i++) flooded.heard(`tab-${String(i).padStart(8, "0")}`, at(i / 10));
  t.check(flooded.count(at(10)), 64);
});
