# Schedule-health episodes and the `scheduled-tasks` check

A scheduled task that keeps failing, is overdue, or cannot parse is a health
entry on the dashboard: the `scheduled-tasks` check. It never notifies on its
own (docs/plans/notifications.md, Track E).

`recordScheduleEpisodes` runs from the scheduler daemon after each box's tick.
It stamps each newly unhealthy task's latch, so the scheduler log records the
episode once, and a successful run clears the latch (via `recordOutcome`), so a
relapse is a new episode.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { recordScheduleEpisodes } from "../../src/core/schedule/health-alert.js";
import { loadScheduleHealth } from "../../src/core/schedule/health-box.js";
import { engineQuotaChecks, scheduledTasksCheck } from "../../src/webapp/trpc/routers/health-schedules.js";
import { readRecent } from "../../src/core/notification/log.js";
import {
  loadScriptState,
  saveScriptState,
  recordOutcome,
} from "../../src/core/schedule/state.js";

const NOW = new Date("2026-06-09T12:00:00Z");

async function seedFailingTask(box) {
  await box.seed("_config/schedules/sync-notes.scheduled-script.card", `---
cron: "0 * * * *"
runs: bbx wakeup --connector notes
---
`);
  await box.seed("_config/schedules/.state/sync-notes.json", JSON.stringify({
    lastRun: "2026-06-09T11:00:00Z",
    lastResult: "failure",
    lastError: "Command failed with exit code 1\nstderr:\nAgent invocation failed: Model gpt-retired is not supported",
    lastSuccess: "2026-06-07T09:00:00Z",
    consecutiveFailures: 4,
    alertedAt: null,
    alertedFor: null,
    runCount: 50,
  }));
}
```

## A failing task is a dashboard check, and nothing is sent

```ts
const box = await makeTmpBox({ git: true });
await seedFailingTask(box);
box.commitAll("seed");

const check = scheduledTasksCheck(await loadScheduleHealth(box.root, NOW), NOW);
`${check.name} | ${check.ok} | ${check.message}`
=> scheduled-tasks | false | Scheduled tasks need attention: sync-notes: failing ×4 (last success 2d ago) — Agent invocation failed: Model gpt-retired is not supported

JSON.stringify(await recordScheduleEpisodes(box.root, { now: NOW }))
=> {"tasks":["sync-notes"]}

(await readRecent(box.root, { days: 1, now: NOW })).length
=> 0
```

The task is latched, so the next daemon cycle records nothing new:

```ts continue
const state = await loadScriptState(box.root, "sync-notes");
print(`alertedFor: ${state.alertedFor}`);
print(`again: ${await recordScheduleEpisodes(box.root, { now: NOW })}`);
=>
alertedFor: failing
again: null
```

A successful run clears the latch and the check; a relapse is a new episode:

```ts continue
recordOutcome(state, {
  result: "success", error: null, durationMs: 100, sleepAffected: false,
  windowMs: 86_400_000, now: new Date("2026-06-09T13:00:00Z"),
});
await saveScriptState({ boxRoot: box.root, scriptName: "sync-notes", state });
scheduledTasksCheck(await loadScheduleHealth(box.root, NOW), NOW).ok
=> true

recordOutcome(state, {
  result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
  windowMs: 86_400_000, now: new Date("2026-06-09T14:00:00Z"),
});
recordOutcome(state, {
  result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
  windowMs: 86_400_000, now: new Date("2026-06-09T15:00:00Z"),
});
await saveScriptState({ boxRoot: box.root, scriptName: "sync-notes", state });

JSON.stringify(await recordScheduleEpisodes(box.root, { now: new Date("2026-06-09T15:05:00Z") }))
=> {"tasks":["sync-notes"]}
```

```ts cleanup
await box.cleanup();
```

## A stale scheduler is a warning, whatever the tasks say

The daemon ran here and stopped: no task can fail or run late in a way the
check would see, so the heartbeat itself is the finding.

```ts
const health = {
  tasks: [],
  scheduler: { status: "stale", lastTickAt: "2026-06-09T09:00:00.000Z", ageMs: 3 * 3_600_000 },
  engineWait: null,
};
const stale = scheduledTasksCheck(health, NOW);
`${stale.ok} | ${stale.severity} | ${stale.message}`
=> false | warning | The scheduler is not running: last heartbeat 2026-06-09T09:00:00.000Z (3h ago)

scheduledTasksCheck({ ...health, scheduler: { status: "running", lastTickAt: "2026-06-09T11:59:00.000Z", ageMs: 60_000 } }, NOW).ok
=> true
```

## Engine quota is a check too

An engine out of usage quota used to notify; it is now the `engine-quota`
check, present only while the episode is live.

```ts
const live = {
  provider: "claude", reason: "quota-exhausted", retryAt: "2026-06-09T18:00:00Z", retryAtSource: "parsed",
  detectedAt: "2026-06-09T10:00:00Z", message: "limit", episodeStartedAt: "2026-06-09T09:00:00Z",
};
const [quota] = engineQuotaChecks(live, NOW);
`${quota.name} | ${quota.ok} | ${quota.message.includes("(for 3h so far)")}`
=> engine-quota | false | true

engineQuotaChecks(null, NOW).length
=> 0
```
