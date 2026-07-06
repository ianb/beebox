/**
 * cb health - Scheduled-task health: which tasks are failing, overdue,
 * blocked, or invalid, and whether the scheduler daemon is alive.
 *
 * The always-available view of the same evaluation that feeds the
 * session-start snapshot and proactive alerts (schedule-health-box.ts).
 * Exit code 1 when anything is failing/overdue/invalid, so scripts can
 * gate on it.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getBoxTime } from "../lib/time.js";
import { assertNever } from "../../lib/invariant.js";
import {
  loadScheduleHealth,
  formatDurationShort,
  type BoxScheduleHealth,
} from "../../core/schedule-health-box.js";
import type { TaskHealth } from "../../core/schedule-health.js";
import { loadRunningScripts, type ScriptLock } from "../../core/schedule-state.js";

const STATUS_GLYPHS: Record<TaskHealth["status"], string> = {
  ok: "✓",
  failing: "✗",
  overdue: "✗",
  blocked: "◷",
  invalid: "✗",
  disabled: "-",
};

function isUnhealthy(task: TaskHealth): boolean {
  return task.status === "failing" || task.status === "overdue" || task.status === "invalid";
}

function describeStatus(task: TaskHealth): string {
  switch (task.status) {
    case "failing":
      return `failing ×${task.consecutiveFailures}`;
    case "overdue":
      return `overdue ${formatDurationShort(task.pendingMs ?? 0)}`;
    case "ok":
    case "blocked":
    case "invalid":
    case "disabled":
      return task.status;
    default:
      return assertNever(task.status);
  }
}

function describeRuns(task: TaskHealth, now: Date): string {
  if (!task.lastRun) return "never run";
  const attempt = `last attempt ${formatDurationShort(now.getTime() - new Date(task.lastRun).getTime())} ago`;
  if (task.lastSuccess === task.lastRun) return attempt.replace("attempt", "success");
  const success = task.lastSuccess
    ? `last success ${formatDurationShort(now.getTime() - new Date(task.lastSuccess).getTime())} ago`
    : "never succeeded";
  return `${attempt}, ${success}`;
}

function printHealth(
  health: BoxScheduleHealth,
  { now, all, running }: { now: Date; all: boolean; running: Map<string, ScriptLock> },
): void {
  const tasks = all ? health.tasks : health.tasks.filter((t) => t.status !== "disabled");
  if (tasks.length === 0) {
    console.log("No scheduled tasks.");
  }
  for (const task of tasks) {
    const lock = running.get(task.name);
    const detail = [
      ...(lock ? [`running (PID ${lock.pid}, since ${formatDurationShort(now.getTime() - new Date(lock.startedAt).getTime())} ago)`] : []),
      describeRuns(task, now),
      ...(task.reason ? [task.reason] : []),
    ].join("; ");
    console.log(
      `  ${lock ? "▶" : STATUS_GLYPHS[task.status]} ${task.name.padEnd(22)} ${describeStatus(task).padEnd(14)} ${detail}`
    );
    if (isUnhealthy(task) && task.lastError) {
      console.log(`      error: ${task.lastError.split("\n")[0]}`);
    }
  }
  const hidden = health.tasks.length - tasks.length;
  if (hidden > 0) console.log(`  (${hidden} disabled — show with --all)`);

  // Running scripts with no matching task card (e.g. ad-hoc / renamed scripts).
  const taskNames = new Set(health.tasks.map((t) => t.name));
  for (const [scriptName, lock] of running) {
    if (taskNames.has(scriptName)) continue;
    console.log(`  ▶ ${scriptName.padEnd(22)} ${"running".padEnd(14)} PID ${lock.pid}, triggered by ${lock.triggeredBy}`);
  }

  const { scheduler } = health;
  if (scheduler.status === "running") {
    console.log(`  scheduler: running (last tick ${formatDurationShort(scheduler.ageMs ?? 0)} ago)`);
  } else if (scheduler.status === "stale") {
    console.log(`  scheduler: NOT RUNNING (last tick ${formatDurationShort(scheduler.ageMs ?? 0)} ago)`);
  } else {
    console.log("  scheduler: never seen on this box (overdue is expected if nothing runs cb tick)");
  }
}

export const healthCommand = new Command("health")
  .description("Show scheduled-task health (failing, overdue, blocked tasks)")
  .option("--json", "Machine-readable output")
  .option("--all", "Include disabled/expired tasks")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: { json?: boolean; all?: boolean; box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    const now = getBoxTime(boxRoot);
    const health = await loadScheduleHealth(boxRoot, now);
    const running = await loadRunningScripts(boxRoot);

    if (options.json) {
      const runningJson = [...running].map(([name, lock]) => ({ name, ...lock }));
      console.log(JSON.stringify({ ...health, running: runningJson }, null, 2));
    } else {
      printHealth(health, { now, all: options.all === true, running });
    }

    if (health.tasks.some(isUnhealthy) || health.scheduler.status === "stale") {
      process.exitCode = 1;
    }
  });
