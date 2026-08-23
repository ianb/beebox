/**
 * Health evaluation for scheduled tasks (see
 * issues/2026-05-19-scheduled-task-health-surfacing.md).
 *
 * A task's run state already records when it was last *attempted*
 * (lastRun) and last *succeeded* (lastSuccess); the divergence is the
 * failure signal. The other signal — a task that stopped being
 * attempted at all — is derived here from the task's own schedule:
 * a due occurrence that has gone unserved for longer than a grace
 * period proportional to the task's own cadence.
 *
 * Trust rule (learned the hard way, commit ae6e71bd): never mislabel a
 * deliberate skip as a failure. Tasks that are unrunnable for a
 * declared reason (budget exhausted, missing connector) are "blocked",
 * not "overdue", and disabled/expired tasks are excluded entirely.
 */

import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import {
  isWithinBudget,
  parseDuration,
  type ParsedScheduledScript,
} from "../../schemas/scheduled-script.js";
import type { ScriptState } from "./state.js";
import { isContendedFailure } from "../../lib/git.js";

const { rrulestr } = rrulePkg;

export type TaskHealthStatus =
  | "ok"
  | "waiting"   // engine unavailable (e.g. quota-exhausted); deferred, not failing
  | "failing"   // last run(s) failed
  | "overdue"   // a due occurrence has gone unattempted past grace
  | "blocked"   // unrunnable for a declared reason (budget, connector)
  | "invalid"   // card doesn't parse — can never run
  | "disabled"; // enabled: false, or past its until date

export interface TaskHealth {
  name: string;
  status: TaskHealthStatus;
  description: string | undefined;
  lastRun: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** How long the earliest unserved occurrence has been pending (overdue only). */
  pendingMs?: number;
  /** Why the task can't run (blocked), is disabled, or didn't parse (invalid). */
  reason?: string;
  alertedAt: string | null;
  alertedFor: ScriptState["alertedFor"];
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Cap on backwards cron iteration when hunting for the earliest missed
 * occurrence — a minutely cron unattended for days would otherwise walk
 * thousands of steps. Hitting the cap just understates how overdue the
 * task is, which doesn't change the verdict. */
const MAX_OCCURRENCE_SCAN = 200;

export interface EvaluateTaskInput {
  name: string;
  parsed: ParsedScheduledScript;
  state: ScriptState;
  now: Date;
  /** Overdue baseline when the task has never been attempted. */
  cardMtime: Date;
  /** Connectors the task requires that aren't configured (precomputed
   * by the caller — connector config lookup is I/O). */
  missingConnectors: string[];
  /** Set when the box's engine is unavailable (quota-exhausted): the
   * waiting phrase, precomputed once per box by the caller (store lookup
   * is I/O). Suppresses failing/overdue for the episode's duration —
   * a task the engine can't serve is deferred, not unhealthy. */
  engineWaitReason?: string | undefined;
}

/**
 * Classify one task. Precedence: disabled > invalid-input states the
 * caller handles > waiting > failing > blocked > overdue > ok. "Waiting"
 * wins over "failing"/"overdue" per the trust rule above: during an engine
 * outage the task is deferred by the system, not broken. "Failing" wins
 * over "blocked" because failures are what consumed the budget; the
 * blocked reason still rides along in `reason`.
 */
export function evaluateTaskHealth(input: EvaluateTaskInput): TaskHealth {
  const { name, parsed, state, now, cardMtime, missingConnectors } = input;
  const base = {
    name,
    description: parsed.description,
    lastRun: state.lastRun,
    lastSuccess: state.lastSuccess,
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError,
    alertedAt: state.alertedAt,
    alertedFor: state.alertedFor,
  };

  if (!parsed.enabled) {
    return { ...base, status: "disabled", reason: "enabled: false" };
  }
  if (parsed.until && now > new Date(parsed.until)) {
    return { ...base, status: "disabled", reason: `expired (until ${parsed.until})` };
  }
  if (input.engineWaitReason !== undefined) {
    return { ...base, status: "waiting", reason: input.engineWaitReason };
  }

  let blockedReason: string | undefined;
  if (missingConnectors.length > 0) {
    blockedReason = `missing connectors: ${missingConnectors.join(", ")}`;
  } else if (parsed.budget) {
    const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
    if (!check.allowed) {
      blockedReason = `budget exhausted (${Math.round(check.usedMs / 1000)}s used)`;
    }
  }

  if (state.consecutiveFailures >= 1) {
    // A task that lost a git-index race never got to run its own work, so the
    // reader should not go debugging the task. Contention still counts as a
    // failure (four in a row is worth surfacing), but it says what it is.
    const contended = state.lastError !== null && isContendedFailure(state.lastError);
    const failureReason = contended
      ? "contended — another process held the box's git index"
      : blockedReason;
    return { ...base, status: "failing", ...(failureReason ? { reason: failureReason } : {}) };
  }
  if (blockedReason) {
    return { ...base, status: "blocked", reason: blockedReason };
  }

  const missed = findMissedOccurrence(parsed, { lastRun: state.lastRun, cardMtime, now });
  if (missed) {
    const pendingMs = now.getTime() - missed.dueAt.getTime();
    if (pendingMs > missed.graceMs) {
      return { ...base, status: "overdue", pendingMs };
    }
  }
  return { ...base, status: "ok" };
}

interface MissedOccurrence {
  /** When the earliest unserved occurrence became actionable. */
  dueAt: Date;
  /** How long past dueAt we tolerate before calling the task overdue. */
  graceMs: number;
}

/**
 * Find the earliest schedule occurrence since the last attempt (or card
 * creation, if never attempted) that should have run by now, plus the
 * grace period derived from the task's own cadence. Returns null when
 * nothing is pending — including for on-wakeup-only tasks, which have
 * no intrinsic cadence to be overdue against.
 */
export function findMissedOccurrence(
  parsed: ParsedScheduledScript,
  { lastRun, cardMtime, now }: { lastRun: string | null; cardMtime: Date; now: Date },
): MissedOccurrence | null {
  const baseline = lastRun ? new Date(lastRun) : cardMtime;
  let earliest: Date | null = null;
  /** Gap between the missed occurrence and the one before it. */
  let cadenceMs: number | null = null;

  if (parsed.cron) {
    const found = scanCronOccurrences(parsed.cron, { baseline, now });
    if (!found) return null;
    ({ earliest, cadenceMs } = found);
  } else if (parsed.rrule) {
    try {
      const rule = rrulestr(parsed.rrule);
      const between = rule.between(baseline, now, false);
      if (between.length === 0) return null;
      earliest = between[0] ?? null;
      const before = earliest ? rule.before(earliest, false) : null;
      if (earliest && before) cadenceMs = earliest.getTime() - before.getTime();
    } catch (_e) {
      return null; // unparseable rrule is reported as invalid elsewhere, not overdue
    }
  } else if (parsed.at) {
    const atDate = new Date(parsed.at);
    if (lastRun || Number.isNaN(atDate.getTime()) || now < atDate) return null;
    earliest = atDate;
  } else {
    return null; // on-wakeup only — no schedule to be overdue against
  }

  if (!earliest) return null;

  const notBeforeMs = parsed.notBefore ? parseDuration(parsed.notBefore) : 0;
  let dueAt = earliest;
  if (lastRun && notBeforeMs > 0) {
    const notBeforeEnd = new Date(new Date(lastRun).getTime() + notBeforeMs);
    if (notBeforeEnd > dueAt) dueAt = notBeforeEnd;
  }
  if (dueAt > now) return null;

  // Grace scales with the task's own rhythm: half the effective cadence,
  // floored at 30 minutes (absorbs busy-gate deferrals and not-before
  // postponements) and capped at a day (a weekly task a day late is
  // still worth hearing about). One-shots without a cadence get an hour.
  const graceMs =
    cadenceMs !== null
      ? Math.min(Math.max(Math.max(cadenceMs, notBeforeMs) / 2, 30 * MINUTE_MS), DAY_MS)
      : Math.max(HOUR_MS, notBeforeMs / 2);
  return { dueAt, graceMs };
}

function scanCronOccurrences(
  cron: string,
  { baseline, now }: { baseline: Date; now: Date },
): { earliest: Date; cadenceMs: number | null } | null {
  let occurrences: Date[];
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: now });
    occurrences = [];
    for (let i = 0; i < MAX_OCCURRENCE_SCAN; i++) {
      const t = interval.prev().toDate();
      occurrences.push(t);
      if (t <= baseline) break;
    }
  } catch (_e) {
    return null; // unparseable cron is reported as invalid elsewhere, not overdue
  }
  // occurrences is newest-first; the missed ones are those after baseline
  const missed = occurrences.filter((t) => t > baseline);
  if (missed.length === 0) return null;
  const earliest = missed[missed.length - 1];
  if (!earliest) return null;
  // The occurrence before the earliest missed one, if the scan reached it
  const prior = occurrences.length > missed.length ? occurrences[missed.length] : null;
  const second = missed.length >= 2 ? missed[missed.length - 2] : null;
  const cadenceMs = prior
    ? earliest.getTime() - prior.getTime()
    : second
      ? second.getTime() - earliest.getTime()
      : null;
  return { earliest, cadenceMs };
}
