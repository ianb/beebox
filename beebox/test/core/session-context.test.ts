// # Session Context
//
// `src/core/session-context.ts` computes the situational attributes the
// server stamps into the per-turn `<chat-app>` snapshot: a human-oriented
// `local-time` (named weekday + phase of day in the box timezone) on every
// message, plus `last-activity` and `calendar` on the first message of a
// brand-new session. See `test/core/chat/features.test.ts` for how the
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
import { recordDocsApiDiagnosis } from "../../src/connectors/google-drive/docs-api-status.js";
import { markGoogleAuthDead, saveGoogleTokens } from "../../src/google/token-store.js";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp } from "node:fs/promises";

// The invalid-timezone example exercises the warn-and-fall-back path;
// silence the documented console.warn so it doesn't pollute test output.
console.warn = () => {};

// ## formatLocalTime
//
// Renders a moment in the given IANA timezone with the named weekday, the zone
// abbreviation, and a phase-of-day label — the three things models misderive
// from a UTC ISO timestamp.
void test("Renders a moment in the given IANA timezone with the named weekday, the zone...", async (t) => {
  t.check(formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "America/Chicago" }), "Tuesday 2026-06-09 14:32 CDT (afternoon)");

  t.check(formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "UTC" }), "Tuesday 2026-06-09 19:32 UTC (evening)");

  t.check(formatLocalTime(new Date("2026-06-09T11:00:00Z"), { timezone: "America/Chicago" }), "Tuesday 2026-06-09 06:00 CDT (morning)");
});

// The local date can differ from the UTC date — late evening in Chicago is
// already the next day in UTC. The weekday and date follow the local zone.
void test("The local date can differ from the UTC date — late evening in Chicago is alre...", async (t) => {
  t.check(formatLocalTime(new Date("2026-06-10T03:30:00Z"), { timezone: "America/Chicago" }), "Tuesday 2026-06-09 22:30 CDT (late night)");
});

// An unusable timezone falls back to server-local time (with a console
// warning) rather than failing — a bad config value must not break sends.
// The output shape is the same; we just can't assert the zone-dependent
// values here.
void test("An unusable timezone falls back to server-local time (with a console warning)...", async (t) => {
  t.check(formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "Not/AZone" }), str`${any(String)} 2026-${any(String)} (${any(String)})`);
});

// ## describeElapsed
//
// Coarse human durations for the `last-activity` attribute.
void test("Coarse human durations for the last-activity attribute.", async (t) => {
  t.check(describeElapsed(30_000), "moments");

  t.check(describeElapsed(60_000), "1 minute");

  t.check(describeElapsed(45 * 60_000), "45 minutes");

  t.check(describeElapsed(5 * 3_600_000), "5 hours");

  t.check(describeElapsed(3 * 86_400_000), "3 days");

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
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  const sendNow = new Date("2026-06-09T10:00:00Z");

  t.check(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false }), {
    localTime: "Tuesday 2026-06-09 10:00 UTC (morning)",
  });

  t.check(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }), {
    localTime: "Tuesday 2026-06-09 10:00 UTC (morning)",
  });

  // With a most-active pointer (written whenever any chat session on the box
  // sees activity), the session-start `lastActivity` extra appears.

  await box.write(".beebox/chat-session-id.json", JSON.stringify({
    sessionId: "prev-session",
    savedAt: "2026-06-06T10:00:00Z",
  }));

  t.check(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }), {
    localTime: "Tuesday 2026-06-09 10:00 UTC (morning)",
    lastActivity: "3 days ago",
  });

  // The `health` extra speaks only when a scheduled task is unhealthy —
  // a healthy box (like everything above) omits it entirely.

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

  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true })).health, "sync-notes: failing ×4 (last success 2d ago)");

  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).health, undefined);

  // The `todos` extra (Track 5a's ambient line) rides on every send, unlike
  // `health` — no gate — but only when there's actually something due now.

  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).todos, undefined);

  await box.write(
    "store/errand.doc.card",
    '---\ntitle: Errand\n---\n{% todo id="call-vet" %}Call the vet{% /todo %}\n'
  );

  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).todos, "1 todo now — `bbx query todos`");
});

// ## admitHealth — the schedule-health rate limit
//
// `admitHealth` keeps the `health` reminder from becoming chatter. A fresh gate
// admits the first failure (session start); the same message then stays quiet until
// a long interval passes; a *changed* message waits out a hard per-turn limit.
// Every call bumps the gate's turn counter, so the limits read as "since last
// shown."
void test("admitHealth keeps the health reminder from becoming chatter.", async (t) => {
  const gate = createHealthGate();
  const t0 = 1_700_000_000_000;
  t.check(admitHealth("check-email: failing", { gate, now: t0 }), true);

  t.check(admitHealth("check-email: failing", { gate, now: t0 + 60_000 }), false);

  t.check(admitHealth("check-calendar: overdue", { gate, now: t0 + 120_000 }), false);

  // Once enough sends pass a changed failure gets through, and the same message
  // re-nudges only after a long interval; a healthy state is never surfaced.

  for (let i = 0; i < 10; i++) admitHealth(null, { gate, now: t0 + 200_000 });
  t.check(admitHealth("check-calendar: overdue", { gate, now: t0 + 300_000 }), true);

  t.check(admitHealth("check-calendar: overdue", { gate, now: t0 + 11 * 24 * 60 * 60 * 1000 }), true);

  t.check(admitHealth(null, { gate, now: t0 + 12 * 24 * 60 * 60 * 1000 }), false);
});

// ## An open Drive problem is introduced once, at chat start
//
// Boxholder decision (2026-10-20): while Drive syncs Google Docs without the
// Docs API, the agent hears of it on the first send of each chat session, so
// it can mention it unasked. It rides apart from the schedule-health gate, so
// a schedule change mid-session neither repeats nor delays it.
void test("An open Drive problem rides on the first send only, whatever schedule health does", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => {
    delete process.env.BBX_GOOGLE_TOKENS_FILE;
    await box.cleanup();
  });
  process.env.BBX_GOOGLE_TOKENS_FILE = path.join(await mkdtemp(path.join(os.tmpdir(), "session-docs-api-")), "google-tokens.json");
  await box.write("_config/box.json", JSON.stringify({ timezone: "UTC", googleServices: { drive: true } }));
  await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });
  const sendNow = new Date("2026-06-09T10:00:00Z");
  const driveLine = "google-drive: Google Docs are syncing without the Docs API (no revision tracking or lossy check); `bbx health` has the fix";

  // No problem: no line.
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true, healthGate: createHealthGate() })).health, undefined);

  await recordDocsApiDiagnosis(box.root, () => ({
    kind: "service-disabled",
    message: "1 Google Doc is syncing without revision tracking or lossy-content details: disabled",
    link: null,
    docs: 1,
    since: "2026-06-09T09:00:00.000Z",
  }));
  const gate = createHealthGate();
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true, healthGate: gate })).health, driveLine);
  t.check((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false, healthGate: gate })).health, undefined);

  // A scheduled task starts failing mid-session. The gate has shown nothing
  // yet, so it admits that line at once; the Drive line does not come back.
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
  const later = [];
  for (let i = 0; i < 10; i++) later.push((await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false, healthGate: gate })).health);
  t.check(later, ["sync-notes: failing ×4 (last success 2d ago)", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);

  // A new session with both open carries both, schedule first.
  t.check(
    (await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true, healthGate: createHealthGate() })).health,
    `sync-notes: failing ×4 (last success 2d ago); ${driveLine}`,
  );

  // Paused for reauthorization: the line speaks of the last sync.
  await markGoogleAuthDead({ reason: "invalid_grant" });
  t.check(
    (await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true, healthGate: createHealthGate() })).health,
    "sync-notes: failing ×4 (last success 2d ago); google-drive: paused until Google is re-authorized; at its last sync, Google Docs synced without the Docs API (no revision tracking or lossy check); `bbx health` has the fix",
  );
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
  const tzBox = await makeTmpBox();
  await tzBox.write("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  process.env.BBX_TIME = "2026-08-12T08:40:00Z";
  const snapshot = await composeSendSnapshot(tzBox.root, { features: {}, sessionStart: false });
  delete process.env.BBX_TIME;
  t.check(snapshot, '<chat-app narration="off" prose="on" local-time="Wednesday 2026-08-12 08:40 UTC (morning)"/>');
});
