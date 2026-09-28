/**
 * Schedule-due evaluation: is a scheduled script due to run now, due for a
 * wakeup opportunistic run, or within its runtime budget. Split out of
 * `schema.tsx` (the same subject, kept under the file-size limit).
 */

import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import { parseDuration } from "../../scheduled-script-duration.js";
import type { ParsedScheduledScript } from "./schema.js";

const { rrulestr } = rrulePkg;

// --- Schedule evaluation ---

export interface ScheduleCheckContext {
  lastRun: string | null;
  now: Date;
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
    const atDate = new Date(script.at);
    return ctx.now >= atDate && !ctx.lastRun;
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
export function isDueForWakeup(script: ParsedScheduledScript, ctx: ScheduleCheckContext): boolean {
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
    const rule = rrulestr(rruleStr);
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

