// # Schedule-health episodes and the `scheduled-tasks` check
//
// A scheduled task that keeps failing, is overdue, or cannot parse is a health
// entry on the dashboard: the `scheduled-tasks` check. It never notifies on its
// own (docs/implemented-plans/notifications.md, Track E).
//
// `recordScheduleEpisodes` runs from the scheduler daemon after each box's tick.
// It stamps each newly unhealthy task's latch, so the scheduler log records the
// episode once, and a successful run clears the latch (via `recordOutcome`), so a
// relapse is a new episode.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import type { StoredEngineUnavailability } from "../../../../src/core/agent/engine-availability-store.js";
import { invariant } from "../../../../src/shared/invariant.js";
import { recordScheduleEpisodes } from "../../../../src/core/schedule/scheduler/health-alert.js";
import { loadScheduleHealth } from "../../../../src/core/schedule/health-box.js";
import type { BoxScheduleHealth } from "../../../../src/core/schedule/health-box.js";
import { engineQuotaChecks, scheduledTasksCheck } from "../../../../src/webapp/trpc/routers/health/checks/schedules.js";
import { readRecent } from "../../../../src/core/notification/log.js";
import {
  loadScriptState,
  saveScriptState,
  recordOutcome,
} from "../../../../src/core/schedule/state.js";

const NOW = new Date("2026-06-09T12:00:00Z");

async function seedFailingTask(box: TmpBox) {
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

// ## A failing task is a dashboard check, and nothing is sent
void test("A failing task is a dashboard check, and nothing is sent", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedFailingTask(box);
  box.commitAll("seed");

  const check = scheduledTasksCheck(await loadScheduleHealth(box.root, NOW), NOW);
  t.check(check, {
    name: "scheduled-tasks",
    ok: false,
    message: "Scheduled tasks need attention: sync-notes: failing ×4 (last success 2d ago) — Agent invocation failed: Model gpt-retired is not supported",
    severity: "warning",
  });

  t.check(await recordScheduleEpisodes(box.root, { now: NOW }), { tasks: ["sync-notes"] });

  t.check(await readRecent(box.root, { days: 1, now: NOW }), []);

  // The task is latched, so the next daemon cycle records nothing new:

  const state = await loadScriptState(box.root, "sync-notes");
  t.check(state.alertedFor, "failing");
  t.check(await recordScheduleEpisodes(box.root, { now: NOW }), null);

  // A successful run clears the latch and the check; a relapse is a new episode:

  recordOutcome(state, {
    result: "success", error: null, durationMs: 100, sleepAffected: false,
    windowMs: 86_400_000, now: new Date("2026-06-09T13:00:00Z"),
  });
  await saveScriptState({ boxRoot: box.root, scriptName: "sync-notes", state });
  t.check(scheduledTasksCheck(await loadScheduleHealth(box.root, NOW), NOW), {
    name: "scheduled-tasks",
    ok: true,
    message: "The scheduler has never run on this box",
    severity: "warning",
  });

  recordOutcome(state, {
    result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
    windowMs: 86_400_000, now: new Date("2026-06-09T14:00:00Z"),
  });
  recordOutcome(state, {
    result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
    windowMs: 86_400_000, now: new Date("2026-06-09T15:00:00Z"),
  });
  await saveScriptState({ boxRoot: box.root, scriptName: "sync-notes", state });

  t.check(await recordScheduleEpisodes(box.root, { now: new Date("2026-06-09T15:05:00Z") }), { tasks: ["sync-notes"] });
});

// ## A stale scheduler is a warning, whatever the tasks say
//
// The daemon ran here and stopped: no task can fail or run late in a way the
// check would see, so the heartbeat itself is the finding.
void test("The daemon ran here and stopped:", async (t) => {
  const health: BoxScheduleHealth = {
    tasks: [],
    scheduler: { status: "stale", lastTickAt: "2026-06-09T09:00:00.000Z", ageMs: 3 * 3_600_000 },
    engineWait: null,
  };
  const stale = scheduledTasksCheck(health, NOW);
  t.check(stale, {
    name: "scheduled-tasks",
    ok: false,
    message: "The scheduler is not running: last heartbeat 2026-06-09T09:00:00.000Z (3h ago)",
    severity: "warning",
  });

  t.check(scheduledTasksCheck({ ...health, scheduler: { status: "running", lastTickAt: "2026-06-09T11:59:00.000Z", ageMs: 60_000 } }, NOW), {
    name: "scheduled-tasks",
    ok: true,
    message: "Scheduled tasks are running",
    severity: "warning",
  });

  // With no heartbeat ever (a dev box, where no daemon runs), the check passes and
  // says so, rather than claiming tasks are running:

  const never = scheduledTasksCheck({ ...health, scheduler: { status: "never", lastTickAt: null, ageMs: null } }, NOW);
  t.check(never, {
    name: "scheduled-tasks",
    ok: true,
    message: "The scheduler has never run on this box",
    severity: "warning",
  });
});

// ## Engine quota is a check too
//
// An engine out of usage quota used to notify; it is now the `engine-quota`
// check, present only while the episode is live.
void test("An engine out of usage quota used to notify; it is now the engine-quota check...", async (t) => {
  const live: StoredEngineUnavailability = {
    provider: "claude", reason: "quota-exhausted", retryAt: "2026-06-09T18:00:00Z", retryAtSource: "parsed",
    detectedAt: "2026-06-09T10:00:00Z", message: "limit", episodeStartedAt: "2026-06-09T09:00:00Z",
  };
  const [quota] = engineQuotaChecks(live, NOW);
  invariant(quota, "a live episode yields the engine-quota check");
  // The retry time prints in the machine's timezone.
  t.check(quota, {
    name: "engine-quota",
    ok: false,
    message: str`The claude engine is out of usage quota until ${any(String)} (for 3h so far). Scheduled work waits until then; chat on this engine fails.`,
    severity: "warning",
  });

  t.check(engineQuotaChecks(null, NOW), []);
});
