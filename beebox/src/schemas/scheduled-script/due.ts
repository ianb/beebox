/**
 * Schedule-due evaluation: is a scheduled script due to run now, due for a
 * wakeup opportunistic run, or within its runtime budget. Split out of
 * `schema.tsx` (the same subject, kept under the file-size limit).
 */

import { CronExpressionParser } from "cron-parser";
import { parseDuration } from "../../scheduled-script-duration.js";
import { parseScheduleRrule } from "../../scheduled-script-fields.js";
import type { ParsedScheduledScript } from "./schema.js";
import type { ScriptState } from "../../core/schedule/state.js";


// --- Schedule evaluation ---

/** The run state `isDueForWakeup` reads. */
export interface WakeupCheckContext {
  lastRun: string | null;
  now: Date;
}

/** The run state `isDue` reads: the last run, and for a reminder's retry, how it ended. */
export interface ScheduleCheckContext extends WakeupCheckContext {
  lastResult: ScriptState["lastResult"];
  consecutiveFailures: number;
  lastFailureFinal: boolean;
}

/** How long after its `at` a failed `notify:` one-shot keeps retrying. */
export const REMINDER_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const MAX_REMINDER_BACKOFF_MINUTES = 60;

/** Wait after the `n`th consecutive failed send before the next try: 1, 2, 4 … minutes, capped at 60. */
export function reminderRetryBackoffMs(consecutiveFailures: number): number {
  const exponent = Math.max(consecutiveFailures, 1) - 1;
  return Math.min(2 ** exponent, MAX_REMINDER_BACKOFF_MINUTES) * MINUTE_MS;
}

/** When a `notify:` one-shot stops retrying, or null for any other card. */
export function reminderRetryEndsAt(script: ParsedScheduledScript): Date | null {
  if (script.at === undefined || script.action.kind !== "notify") return null;
  return new Date(new Date(script.at).getTime() + REMINDER_RETRY_WINDOW_MS);
}

/**
 * Check if a scheduled script is due to run.
 */
export function isDue(script: ParsedScheduledScript, ctx: ScheduleCheckContext): boolean {
  if (!script.enabled) return false;

  if (script.until) {
    const untilDate = new Date(script.until);
    if (ctx.now > untilDate) return false;
  }

  if (script.notBefore && ctx.lastRun) {
    const minInterval = parseDuration(script.notBefore);
    const elapsed = ctx.now.getTime() - new Date(ctx.lastRun).getTime();
    if (elapsed < minInterval) return false;
  }

  if (script.cron) {
    return isCronDue(script.cron, ctx);
  }

  if (script.at) {
    return isAtDue(script, ctx);
  }

  if (script.rrule) {
    return isRruleDue(script.rrule, ctx);
  }

  return script.onWakeup;
}

/**
 * Check if a script should run during wakeup (on-wakeup check).
 * Only checks not-before constraint, not the cron/at/rrule schedule.
 */
export function isDueForWakeup(script: ParsedScheduledScript, ctx: WakeupCheckContext): boolean {
  if (!script.enabled) return false;
  if (!script.onWakeup) return false;

  if (script.until) {
    const untilDate = new Date(script.until);
    if (ctx.now > untilDate) return false;
  }

  if (script.notBefore && ctx.lastRun) {
    const minInterval = parseDuration(script.notBefore);
    const elapsed = ctx.now.getTime() - new Date(ctx.lastRun).getTime();
    if (elapsed < minInterval) return false;
  }

  return true;
}

/**
 * Check if a script is within its runtime budget.
 * Returns true if the script is allowed to run (budget not exceeded).
 * Sums run durations within the budget window. Durations are awake
 * runtime (exec-with-timeout measures them sleep-free), so runs flagged
 * sleepAffected count like any other — the flag is informational.
 */
export function isWithinBudget(
  budget: { limitMs: number; windowMs: number },
  opts: { recentRuns: Array<{ ts: string; durationMs: number; sleepAffected?: boolean | undefined }> | undefined; now: Date },
): { allowed: boolean; usedMs: number } {
  const cutoff = opts.now.getTime() - budget.windowMs;
  const runs = opts.recentRuns ?? [];
  let usedMs = 0;
  for (const r of runs) {
    if (new Date(r.ts).getTime() >= cutoff) {
      usedMs += r.durationMs;
    }
  }
  return { allowed: usedMs < budget.limitMs, usedMs };
}

/**
 * A one-shot is due once, at `at`. A `notify:` one-shot whose send did not get
 * through (`failure`, or `deferred` as recorded before sends skipped the engine
 * classifier) stays due with backoff until its retry window ends, unless the
 * failure was final: no channel was tried, so a retry cannot reach anyone. A
 * final failure holds only for the `at` it was recorded for: a card edited to
 * an `at` after that run is a new attempt. A `runs:` one-shot gets one
 * attempt: its command may have side effects.
 */
function isAtDue(script: ParsedScheduledScript, ctx: ScheduleCheckContext): boolean {
  const now = ctx.now.getTime();
  if (script.at === undefined || now < new Date(script.at).getTime()) return false;
  if (!ctx.lastRun) return true;
  const retryEndsAt = reminderRetryEndsAt(script);
  if (retryEndsAt === null || now >= retryEndsAt.getTime()) return false;
  if (ctx.lastResult !== "failure" && ctx.lastResult !== "deferred") return false;
  const lastRun = new Date(ctx.lastRun).getTime();
  if (ctx.lastFailureFinal && lastRun >= new Date(script.at).getTime()) return false;
  return now >= lastRun + reminderRetryBackoffMs(ctx.consecutiveFailures);
}

function isCronDue(cronExpr: string, ctx: ScheduleCheckContext): boolean {
  try {
    const interval = CronExpressionParser.parse(cronExpr, {
      currentDate: ctx.now,
    });
    const prev = interval.prev().toDate();
    if (!ctx.lastRun) {
      return prev <= ctx.now;
    }
    return prev > new Date(ctx.lastRun);
  } catch (e) {
    // Schema validation rejects an unparseable cron string at authoring
    // time, so this should be unreachable in practice — but if a card
    // slips through (an old box, a hand-edited file), degrade visibly
    // rather than silently never firing.
    console.warn(`isCronDue: invalid cron expression "${cronExpr}":`, e);
    return false;
  }
}

function isRruleDue(rruleStr: string, ctx: ScheduleCheckContext): boolean {
  try {
    const rule = parseScheduleRrule(rruleStr);
    const after = ctx.lastRun ? new Date(ctx.lastRun) : new Date(0);
    const occurrences = rule.between(after, ctx.now, false);
    return occurrences.length > 0;
  } catch (e) {
    // See isCronDue: near-unreachable once the schema validates RRULEs,
    // but a slipped-through card should degrade visibly.
    console.warn(`isRruleDue: invalid RRULE "${rruleStr}":`, e);
    return false;
  }
}

