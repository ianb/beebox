# Session Context

`src/core/session-context.ts` computes the situational attributes the
server stamps into the per-turn `<chat-app>` snapshot: a human-oriented
`local-time` (named weekday + phase of day in the box timezone) on every
message, plus `last-activity` and `calendar` on the first message of a
brand-new session. See `test/chat-features.doctest.md` for how the
attributes serialize into the tag.

```ts setup
import {
  admitHealth,
  buildSnapshotContext,
  composeSendSnapshot,
  createHealthGate,
  describeElapsed,
  formatLocalTime,
} from "../../src/core/session-context.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// The invalid-timezone example exercises the warn-and-fall-back path;
// silence the documented console.warn so it doesn't pollute test output.
console.warn = () => {};
```

## formatLocalTime

Renders a moment in the given IANA timezone with the named weekday, the zone
abbreviation, and a phase-of-day label — the three things models misderive
from a UTC ISO timestamp.

```ts
formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "America/Chicago" })
=> Tuesday 2026-06-09 14:32 CDT (afternoon)

formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "UTC" })
=> Tuesday 2026-06-09 19:32 UTC (evening)

formatLocalTime(new Date("2026-06-09T11:00:00Z"), { timezone: "America/Chicago" })
=> Tuesday 2026-06-09 06:00 CDT (morning)
```

The local date can differ from the UTC date — late evening in Chicago is
already the next day in UTC. The weekday and date follow the local zone.

```ts
formatLocalTime(new Date("2026-06-10T03:30:00Z"), { timezone: "America/Chicago" })
=> Tuesday 2026-06-09 22:30 CDT (late night)
```

An unusable timezone falls back to server-local time (with a console
warning) rather than failing — a bad config value must not break sends.
The output shape is the same; we just can't assert the zone-dependent
values here.

```ts
formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "Not/AZone" })
=> «*» 2026-«*» («*»)
```

## describeElapsed

Coarse human durations for the `last-activity` attribute.

```ts
describeElapsed(30_000)
=> moments

describeElapsed(60_000)
=> 1 minute

describeElapsed(45 * 60_000)
=> 45 minutes

describeElapsed(5 * 3_600_000)
=> 5 hours

describeElapsed(3 * 86_400_000)
=> 3 days

describeElapsed(21 * 86_400_000)
=> 3 weeks
```

## buildSnapshotContext

The per-send entry point. `localTime` is always present; the
session-start extras only when `sessionStart` is true. A mid-session
send computes only the local time, and a session-start send on a
pristine box (no prior activity, no calendar) degrades to the same —
the extras are omitted, never empty strings.

```ts
const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ timezone: "UTC" }));
const sendNow = new Date("2026-06-09T10:00:00Z");

JSON.stringify(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false }))
=> {"localTime":"Tuesday 2026-06-09 10:00 UTC (morning)"}

JSON.stringify(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }))
=> {"localTime":"Tuesday 2026-06-09 10:00 UTC (morning)"}
```

With a most-active pointer (written whenever any chat session on the box
sees activity), the session-start `lastActivity` extra appears.

```ts continue
await box.write(".beebox/chat-session-id.json", JSON.stringify({
  sessionId: "prev-session",
  savedAt: "2026-06-06T10:00:00Z",
}));

JSON.stringify(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }), null, 2)
=> {
  "localTime": "Tuesday 2026-06-09 10:00 UTC (morning)",
  "lastActivity": "3 days ago"
}
```

The `health` extra speaks only when a scheduled task is unhealthy —
a healthy box (like everything above) omits it entirely.

```ts continue
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

(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true })).health
=> sync-notes: failing ×4 (last success 2d ago)

(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).health
=> undefined
```

The `todos` extra (Track 5a's ambient line) rides on every send, unlike
`health` — no gate — but only when there's actually something on the plate.

```ts continue
(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).todos
=> undefined

await box.write(
  "store/errand.memo.card",
  '---\nstatus: new\ncreated: 2026-06-01T10:00:00Z\n---\n{% todo id="call-vet" %}Call the vet{% /todo %}\n'
);

(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).todos
=> 1 open todo on the plate — `bbx todos`
```

```ts cleanup
await box.cleanup();
```

## admitHealth — the schedule-health rate limit

`admitHealth` keeps the `health` reminder from becoming chatter. A fresh gate
admits the first failure (session start); the same message then stays quiet until
a long interval passes; a *changed* message waits out a hard per-turn limit.
Every call bumps the gate's turn counter, so the limits read as "since last
shown."

```ts
const gate = createHealthGate();
const t0 = 1_700_000_000_000;
admitHealth("check-email: failing", { gate, now: t0 })
=> true

admitHealth("check-email: failing", { gate, now: t0 + 60_000 })
=> false

admitHealth("check-calendar: overdue", { gate, now: t0 + 120_000 })
=> false
```

Once enough sends pass a changed failure gets through, and the same message
re-nudges only after a long interval; a healthy state is never surfaced.

```ts continue
for (let i = 0; i < 10; i++) admitHealth(null, { gate, now: t0 + 200_000 });
admitHealth("check-calendar: overdue", { gate, now: t0 + 300_000 })
=> true

admitHealth("check-calendar: overdue", { gate, now: t0 + 11 * 24 * 60 * 60 * 1000 })
=> true

admitHealth(null, { gate, now: t0 + 12 * 24 * 60 * 60 * 1000 })
=> false
```

## composeSendSnapshot stamps BOX time, not wall time

The `local-time` attribute is what the agent reasons about "today" and
day-of-week from, so it must come from `getBoxTime` (which honors
`BBX_TIME`), never the process clock. Field-test run 2 caught the
regression this pins: a BBX_TIME-frozen box whose agent confidently told
the user the real-world weekday ("Sunday, actually") while the box clock
said Wednesday.

```ts
const tzBox = await makeTmpBox();
await tzBox.write("_config/box.json", JSON.stringify({ timezone: "UTC" }));
process.env.BBX_TIME = "2026-08-12T08:40:00Z";
const snapshot = await composeSendSnapshot(tzBox.root, { features: {}, sessionStart: false });
delete process.env.BBX_TIME;
snapshot.includes('local-time="Wednesday 2026-08-12 08:40 UTC (morning)"')
=> true
```

```ts cleanup
await tzBox.cleanup();
```
