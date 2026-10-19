// # Session Context
//
// `src/core/session-context.ts` computes the situational attributes the
// server stamps into the per-turn `<chat-app>` snapshot: a human-oriented
// `local-time` (named weekday + phase of day in the box timezone) on every
// message, plus `last-activity` and `calendar` on the first message of a
// brand-new session. See `test/chat-features.doctest.md` for how the
// attributes serialize into the tag.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import {
  admitHealth,
  buildSnapshotContext,
  composeSendSnapshot,
  createHealthGate,
  describeElapsed,
  formatLocalTime,
} from "../../src/core/session-context.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// The invalid-timezone example exercises the warn-and-fall-back path;
// silence the documented console.warn so it doesn't pollute test output.
console.warn = () => {};

// ## formatLocalTime
//
// Renders a moment in the given IANA timezone with the named weekday, the zone
// abbreviation, and a phase-of-day label — the three things models misderive
// from a UTC ISO timestamp.
void test("Renders a moment in the given IANA timezone with the named weekday, the zone...", async (t) => {
  // doctest:L33
  t.check(formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "America/Chicago" }), "Tuesday 2026-06-09 14:32 CDT (afternoon)");

  // doctest:L36
  t.check(formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "UTC" }), "Tuesday 2026-06-09 19:32 UTC (evening)");

  // doctest:L39
  t.check(formatLocalTime(new Date("2026-06-09T11:00:00Z"), { timezone: "America/Chicago" }), "Tuesday 2026-06-09 06:00 CDT (morning)");
});

// The local date can differ from the UTC date — late evening in Chicago is
// already the next day in UTC. The weekday and date follow the local zone.
void test("The local date can differ from the UTC date — late evening in Chicago is alre...", async (t) => {
  // doctest:L47
  t.check(formatLocalTime(new Date("2026-06-10T03:30:00Z"), { timezone: "America/Chicago" }), "Tuesday 2026-06-09 22:30 CDT (late night)");
});

// An unusable timezone falls back to server-local time (with a console
// warning) rather than failing — a bad config value must not break sends.
// The output shape is the same; we just can't assert the zone-dependent
// values here.
void test("An unusable timezone falls back to server-local time (with a console warning)...", async (t) => {
  // doctest:L57
  t.check(formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "Not/AZone" }), str`${any(String)} 2026-${any(String)} (${any(String)})`);
});

// ## describeElapsed
//
// Coarse human durations for the `last-activity` attribute.
void test("Coarse human durations for the last-activity attribute.", async (t) => {
  // doctest:L66
  t.check(describeElapsed(30_000), "moments");

  // doctest:L69
  t.check(describeElapsed(60_000), "1 minute");

  // doctest:L72
  t.check(describeElapsed(45 * 60_000), "45 minutes");

  // doctest:L75
  t.check(describeElapsed(5 * 3_600_000), "5 hours");

  // doctest:L78
  t.check(describeElapsed(3 * 86_400_000), "3 days");

  // doctest:L81
  t.check(describeElapsed(21 * 86_400_000), "3 weeks");
});

// ## buildSnapshotContext
//
// The per-send entry point. `localTime` is always present; the
// session-start extras only when `sessionStart` is true. A mid-session
// send computes only the local time, and a session-start send on a
// pristine box (no prior activity, no calendar) degrades to the same —
// the extras are omitted, never empty strings.
void test("The per-send entry point.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L94
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  const sendNow = new Date("2026-06-09T10:00:00Z");

  // doctest:L98
  t.check(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false }), {
    localTime: "Tuesday 2026-06-09 10:00 UTC (morning)",
  });

  // doctest:L101
  t.check(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }), {
    localTime: "Tuesday 2026-06-09 10:00 UTC (morning)",
  });

  // With a most-active pointer (written whenever any chat session on the box
  // sees activity), the session-start `lastActivity` extra appears.

  // doctest:L109
  await box.write(".beebox/chat-session-id.json", JSON.stringify({
    sessionId: "prev-session",
    savedAt: "2026-06-06T10:00:00Z",
  }));

  // doctest:L114
  t.check(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }), {
    localTime: "Tuesday 2026-06-09 10:00 UTC (morning)",
    lastActivity: "3 days ago",
  });

  // The `health` extra speaks only when a scheduled task is unhealthy —
  // a healthy box (like everything above) omits it entirely.

  // doctest:L125
  await box.write("_config/schedules/sync-notes.scheduled-script.card", `---
cron: "0 * * * *"
runs: bbx wakeup --connector notes
---
`);
  await box.write("_config/schedules/.state/sync-notes.json", JSON.stringify({
    lastRun: "2026-06-09T09:00:00Z",
    lastResult: "failure",
    lastError: "ENETUNREACH",
    lastSuccess: "2026-06-07T09:00:00Z",
    consecutiveFailures: 4,
    runCount: 50,
  }));

  // doctest:L139
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true })).health, "sync-notes: failing ×4 (last success 2d ago)");

  // doctest:L142
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).health, undefined);

  // The `todos` extra (Track 5a's ambient line) rides on every send, unlike
  // `health` — no gate — but only when there's actually something on the plate.

  // doctest:L150
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).todos, undefined);

  // doctest:L153
  await box.write(
    "store/errand.doc.card",
    '---\ntitle: Errand\n---\n{% todo id="call-vet" %}Call the vet{% /todo %}\n'
  );

  // doctest:L158
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).todos, "1 open todo on the plate — `bbx query todos`");
});

// ## admitHealth — the schedule-health rate limit
//
// `admitHealth` keeps the `health` reminder from becoming chatter. A fresh gate
// admits the first failure (session start); the same message then stays quiet until
// a long interval passes; a *changed* message waits out a hard per-turn limit.
// Every call bumps the gate's turn counter, so the limits read as "since last
// shown."
void test("admitHealth keeps the health reminder from becoming chatter.", async (t) => {
  // doctest:L175
  const gate = createHealthGate();
  const t0 = 1_700_000_000_000;
  t.check(admitHealth("check-email: failing", { gate, now: t0 }), true);

  // doctest:L180
  t.check(admitHealth("check-email: failing", { gate, now: t0 + 60_000 }), false);

  // doctest:L183
  t.check(admitHealth("check-calendar: overdue", { gate, now: t0 + 120_000 }), false);

  // Once enough sends pass a changed failure gets through, and the same message
  // re-nudges only after a long interval; a healthy state is never surfaced.

  // doctest:L191
  for (let i = 0; i < 10; i++) admitHealth(null, { gate, now: t0 + 200_000 });
  t.check(admitHealth("check-calendar: overdue", { gate, now: t0 + 300_000 }), true);

  // doctest:L195
  t.check(admitHealth("check-calendar: overdue", { gate, now: t0 + 11 * 24 * 60 * 60 * 1000 }), true);

  // doctest:L198
  t.check(admitHealth(null, { gate, now: t0 + 12 * 24 * 60 * 60 * 1000 }), false);
});

// ## composeSendSnapshot stamps BOX time, not wall time
//
// The `local-time` attribute is what the agent reasons about "today" and
// day-of-week from, so it must come from `getBoxTime` (which honors
// `BBX_TIME`), never the process clock. Field-test run 2 caught the
// regression this pins: a BBX_TIME-frozen box whose agent confidently told
// the user the real-world weekday ("Sunday, actually") while the box clock
// said Wednesday.
void test("The local-time attribute is what the agent reasons about \"today\" and day-of-w...", async (t) => {
  t.teardown(async () => {
    try {
      await tzBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L212
  const tzBox = await makeTmpBox();
  await tzBox.write("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  process.env.BBX_TIME = "2026-08-12T08:40:00Z";
  const snapshot = await composeSendSnapshot(tzBox.root, { features: {}, sessionStart: false });
  delete process.env.BBX_TIME;
  t.check(snapshot, '<chat-app narration="off" prose="on" local-time="Wednesday 2026-08-12 08:40 UTC (morning)"/>');
});
