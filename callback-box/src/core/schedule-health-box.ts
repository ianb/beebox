/**
 * Box-level schedule health: walk config/schedules/, evaluate each task
 * (schedule-health.ts), check the scheduler daemon's heartbeat, and
 * summarize for the surfaces that show health (cb health, the
 * session-start snapshot, proactive alerts).
 *
 * Heartbeat semantics: the scheduler daemon touches a per-box file each
 * poll cycle. A *stale* heartbeat means the daemon ran here and stopped
 * — the loudest possible finding. A *never* heartbeat means no daemon
 * has ever run for this box (typical for local dev boxes), so overdue
 * findings are suppressed in summaries: nothing is expected to run
 * cron schedules there, and crying wolf on every dev session would
 * erode trust in the signal.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseScheduledScript,
  type ScheduledScriptFields,
} from "../schemas/scheduled-script.js";
import { parseCardText } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { checkMissingConnectors } from "../connectors/requirements.js";
import { loadScriptState } from "./schedule-state.js";
import { evaluateTaskHealth, type TaskHealth } from "./schedule-health.js";

const HEARTBEAT_FILE = ".callback-box/scheduler-heartbeat";
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const MAX_SUMMARY_ITEMS = 3;

export interface SchedulerHeartbeat {
  status: "running" | "stale" | "never";
  lastTickAt: string | null;
  ageMs: number | null;
}

export interface BoxScheduleHealth {
  tasks: TaskHealth[];
  scheduler: SchedulerHeartbeat;
}

/** Record that the scheduler daemon is alive for this box. */
export async function touchSchedulerHeartbeat(boxRoot: string): Promise<void> {
  const file = path.join(boxRoot, HEARTBEAT_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, new Date().toISOString() + "\n");
}

export async function checkSchedulerHeartbeat(
  boxRoot: string,
  now: Date,
): Promise<SchedulerHeartbeat> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, HEARTBEAT_FILE), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read scheduler heartbeat for ${boxRoot}:`, e);
    }
    return { status: "never", lastTickAt: null, ageMs: null };
  }
  const lastTickAt = content.trim();
  const ageMs = now.getTime() - new Date(lastTickAt).getTime();
  if (Number.isNaN(ageMs)) {
    return { status: "never", lastTickAt: null, ageMs: null };
  }
  return {
    status: ageMs > HEARTBEAT_STALE_MS ? "stale" : "running",
    lastTickAt,
    ageMs,
  };
}

/**
 * Evaluate the health of every scheduled task in the box. Cards that
 * fail to parse get status "invalid" — a task that can never run is a
 * health finding, not a loader error.
 */
export async function loadScheduleHealth(boxRoot: string, now: Date): Promise<BoxScheduleHealth> {
  const scheduler = await checkSchedulerHeartbeat(boxRoot, now);
  const schedulesDir = path.join(boxRoot, "config/schedules");
  let files: string[];
  try {
    files = (await fs.readdir(schedulesDir)).filter((f) => f.endsWith(".scheduled-script.card"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read schedules directory ${schedulesDir}:`, e);
    }
    return { tasks: [], scheduler };
  }

  const tasks: TaskHealth[] = [];
  for (const file of files.toSorted()) {
    const name = file.replace(".scheduled-script.card", "");
    const cardPath = path.join(schedulesDir, file);
    const state = await loadScriptState(boxRoot, name);
    let cardMtime = now;
    try {
      cardMtime = (await fs.stat(cardPath)).mtime;
      const content = await fs.readFile(cardPath, "utf-8");
      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
      const parsed = parseScheduledScript(card.fields as unknown as ScheduledScriptFields);
      const missingConnectors = parsed.requires
        ? await checkMissingConnectors(boxRoot, parsed.requires)
        : [];
      tasks.push(evaluateTaskHealth({ name, parsed, state, now, cardMtime, missingConnectors }));
    } catch (err) {
      tasks.push({
        name,
        status: "invalid",
        description: undefined,
        lastRun: state.lastRun,
        lastSuccess: state.lastSuccess,
        consecutiveFailures: state.consecutiveFailures,
        lastError: state.lastError,
        reason: `card does not parse: ${(err as Error).message}`,
        alertedAt: state.alertedAt,
        alertedFor: state.alertedFor,
      });
    }
  }
  return { tasks, scheduler };
}

/** Short duration for summaries: 45m, 26h, 3d. */
export function formatDurationShort(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function describeUnhealthyTask(task: TaskHealth, now: Date): string {
  if (task.status === "invalid") return `${task.name}: card invalid`;
  if (task.status === "overdue") {
    return `${task.name}: overdue ${formatDurationShort(task.pendingMs ?? 0)}`;
  }
  const since = task.lastSuccess
    ? `last success ${formatDurationShort(now.getTime() - new Date(task.lastSuccess).getTime())} ago`
    : "never succeeded";
  return `${task.name}: failing ×${task.consecutiveFailures} (${since})`;
}

/**
 * One-line health summary, or null when there is nothing to say —
 * the session-start surface only speaks when something is wrong.
 * Overdue findings are folded into the scheduler-down finding when the
 * daemon is stale, and suppressed entirely when no daemon has ever run
 * for this box.
 */
export function summarizeScheduleHealth(health: BoxScheduleHealth, now: Date): string | null {
  const parts: string[] = [];
  if (health.scheduler.status === "stale") {
    parts.push(
      `scheduler not running (last tick ${formatDurationShort(health.scheduler.ageMs ?? 0)} ago)`,
    );
  }
  const speaking = health.tasks.filter(
    (t) =>
      t.status === "failing" ||
      t.status === "invalid" ||
      (t.status === "overdue" && health.scheduler.status === "running"),
  );
  parts.push(...speaking.slice(0, MAX_SUMMARY_ITEMS).map((t) => describeUnhealthyTask(t, now)));
  const overflow = speaking.length - MAX_SUMMARY_ITEMS;
  if (overflow > 0) parts.push(`+${overflow} more unhealthy`);
  return parts.length > 0 ? parts.join("; ") : null;
}

/** Threshold for proactively alerting on repeated failures: a single
 * transient failure self-heals at the next occurrence; two in a row is
 * a pattern. Invalid cards alert immediately (deterministic), overdue
 * tasks alert once past their grace (already built into the status). */
const ALERT_AFTER_CONSECUTIVE_FAILURES = 2;

/** The tasks that warrant a proactive notification (before latch filtering). */
export function selectAlertableTasks(health: BoxScheduleHealth): TaskHealth[] {
  return health.tasks.filter(
    (t) =>
      (t.status === "failing" && t.consecutiveFailures >= ALERT_AFTER_CONSECUTIVE_FAILURES) ||
      t.status === "invalid" ||
      t.status === "overdue",
  );
}
