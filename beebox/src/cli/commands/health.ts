/**
 * bbx health - Box health in two sections:
 *
 *  - **Scheduled tasks** — which are failing, overdue, blocked, or invalid, and
 *    whether the scheduler daemon is alive. The always-available view of the
 *    same evaluation that feeds the session-start snapshot and proactive alerts
 *    (schedule-health-box.ts).
 *  - **Box checks** — the permissions/credentials/engine sweep behind the
 *    dashboard's health warnings (`runHealthChecks`), including whether the
 *    Google authorization is still live. The `scheduled-tasks` check is left
 *    out here: it restates the task section for the dashboard.
 *
 * Exit code 1 when a task is failing/overdue/invalid or a box check fails at
 * `error` severity, so scripts can gate on it. Warnings (a dead Google grant
 * among them) are reported but don't fail the command — they degrade features,
 * they don't stop the box.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { getBoxTime } from "../../lib/time.js";
import { assertNever } from "../../lib/invariant.js";
import {
  loadScheduleHealth,
  formatDurationShort,
  describeParkedUpdates,
  type BoxScheduleHealth,
} from "../../core/schedule/health-box.js";
import { conciseScheduleError, type TaskHealth } from "../../core/schedule/health.js";
import { loadRunningScripts, type ScriptLock } from "../../core/schedule/state.js";
import { runHealthChecks, type HealthCheck } from "../../webapp/trpc/routers/health/router.js";

const STATUS_GLYPHS: Record<TaskHealth["status"], string> = {
  ok: "✓",
  waiting: "◷",
  // "?" and not "✗": nobody knows whether this one is fine.
  inconclusive: "?",
  failing: "✗",
  overdue: "✗",
  blocked: "◷",
  invalid: "✗",
  disabled: "-",
};

/**
 * What makes `bbx health` exit 1. An inconclusive task is deliberately absent:
 * its work completed and nothing found a defect, so gating a script on it
 * would report a healthy box as broken — the exact confusion this status was
 * added to end. It still prints, with a "?" and its reason.
 */
function isUnhealthy(task: TaskHealth): boolean {
  return task.status === "failing" || task.status === "overdue" || task.status === "invalid";
}

function describeStatus(task: TaskHealth): string {
  switch (task.status) {
    case "failing":
      return `failing ×${task.consecutiveFailures}`;
    case "overdue":
      return `overdue ${formatDurationShort(task.pendingMs ?? 0)}`;
    case "waiting":
      // The reason is the status here ("waiting: nothing to do"), so the
      // detail column leaves it out.
      return task.reason === undefined ? "waiting" : `waiting: ${task.reason}`;
    case "ok":
    case "inconclusive":
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

function pushTaskLines(
  health: BoxScheduleHealth,
  { now, all, running, lines }: { now: Date; all: boolean; running: Map<string, ScriptLock>; lines: string[] },
): void {
  const tasks = all ? health.tasks : health.tasks.filter((t) => t.status !== "disabled");
  if (tasks.length === 0) {
    lines.push("No scheduled tasks.");
  }
  for (const task of tasks) {
    const lock = running.get(task.name);
    const detail = [
      ...(lock ? [`running (PID ${lock.pid}, since ${formatDurationShort(now.getTime() - new Date(lock.startedAt).getTime())} ago)`] : []),
      describeRuns(task, now),
      ...(task.reason && task.status !== "waiting" ? [task.reason] : []),
    ].join("; ");
    lines.push(
      `  ${lock ? "▶" : STATUS_GLYPHS[task.status]} ${task.name.padEnd(22)} ${describeStatus(task).padEnd(14)} ${detail}`
    );
    if ((isUnhealthy(task) || task.status === "inconclusive") && task.lastError) {
      lines.push(`      error: ${conciseScheduleError(task.lastError)}`);
    }
    // The cross-reference the boxholder otherwise has to make by hand between
    // `bbx health` and `bbx status`: this task's own fix is parked, unread.
    const parked = describeParkedUpdates(task);
    if (parked !== null && (isUnhealthy(task) || task.status === "inconclusive")) {
      lines.push(`      ${parked}`);
    }
  }
  const hidden = health.tasks.length - tasks.length;
  if (hidden > 0) lines.push(`  (${hidden} disabled — show with --all)`);

  // Running scripts with no matching task card (e.g. ad-hoc / renamed scripts).
  const taskNames = new Set(health.tasks.map((t) => t.name));
  for (const [scriptName, lock] of running) {
    if (taskNames.has(scriptName)) continue;
    lines.push(`  ▶ ${scriptName.padEnd(22)} ${"running".padEnd(14)} PID ${lock.pid}, triggered by ${lock.triggeredBy}`);
  }

  if (health.engineWait !== null) {
    lines.push(`  engine: ${health.engineWait}`);
  }
  const { scheduler } = health;
  if (scheduler.status === "running") {
    lines.push(`  scheduler: running (last tick ${formatDurationShort(scheduler.ageMs ?? 0)} ago)`);
  } else if (scheduler.status === "stale") {
    lines.push(`  scheduler: NOT RUNNING (last tick ${formatDurationShort(scheduler.ageMs ?? 0)} ago)`);
  } else {
    lines.push("  scheduler: never seen on this box (overdue is expected if nothing runs bbx tick)");
  }
}

function pushBoxCheckLines(allChecks: HealthCheck[], lines: string[]): void {
  // The task section above already lists every unhealthy task; the
  // `scheduled-tasks` check says the same for the dashboard.
  const checks = allChecks.filter((c) => c.name !== "scheduled-tasks");
  lines.push("");
  lines.push("Box checks:");
  const failures = checks.filter((c) => !c.ok);
  if (failures.length === 0) {
    lines.push(`  ✓ all ${String(checks.length)} checks pass`);
    return;
  }
  for (const check of failures) {
    const glyph = check.severity === "error" ? "✗" : "!";
    lines.push(`  ${glyph} ${check.name.padEnd(22)} ${check.message}`);
  }
  const passing = checks.length - failures.length;
  if (passing > 0) lines.push(`  (${String(passing)} other checks pass)`);
}

/** The text `bbx health` prints: the task section, then the box checks. */
export function formatHealthText(
  health: BoxScheduleHealth,
  { boxChecks, now, all, running }: { boxChecks: HealthCheck[]; now: Date; all: boolean; running: Map<string, ScriptLock> },
): string {
  const lines: string[] = [];
  pushTaskLines(health, { now, all, running, lines });
  pushBoxCheckLines(boxChecks, lines);
  return lines.join("\n");
}

export const healthCommand = new Command("health")
  .description("Show box health: scheduled tasks plus permission/credential checks")
  .option("--json", "Machine-readable output")
  .option("--all", "Include disabled/expired tasks")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: { json?: boolean; all?: boolean; box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    const now = getBoxTime(boxRoot);
    const health = await loadScheduleHealth(boxRoot, now);
    const running = await loadRunningScripts(boxRoot);
    const boxChecks = await runHealthChecks(boxRoot, { scheduleHealth: health });

    if (options.json) {
      const runningJson = [...running].map(([name, lock]) => ({ name, ...lock }));
      console.log(JSON.stringify({ ...health, running: runningJson, boxChecks }, null, 2));
    } else {
      console.log(formatHealthText(health, { boxChecks, now, all: options.all === true, running }));
    }

    const checkFailed = boxChecks.some((c) => !c.ok && c.severity === "error");
    if (health.tasks.some(isUnhealthy) || health.scheduler.status === "stale" || checkFailed) {
      process.exitCode = 1;
    }
  });
