/**
 * The crash-loop retry policy for hub-supervised boxes — how many consecutive
 * failed launches a box gets, and how long to wait before each retry.
 *
 * Split from `supervisor.ts` for its 300-line cap, the same way `child-env.ts`
 * and `child-spawn.ts` were, and it stands on its own: this is the policy, and
 * `supervisor.ts` is the machinery that applies it.
 */

import { LOCK_STALE_MS } from "../../lib/file-lock.js";

/**
 * After this many consecutive failed starts, mark the box unhealthy and switch
 * from the fast backoff to {@link UNHEALTHY_RETRY_MS}. `reloadUnhealthy()`
 * (SIGHUP) retries at once. Chosen per the plan's explicit "pick N=5 unless
 * you find a better precedent" guidance.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * How often an unhealthy box is retried. It never stops: a box child that
 * crashed must come back without a human (boxholder, 2026-10-25). It equals
 * the default lock stale window, so any default-profile lock a dead child
 * left has cleared by the first slow retry.
 */
export const UNHEALTHY_RETRY_MS = LOCK_STALE_MS.default;

/** Default first-retry delay; doubles per consecutive failure. */
export const BASE_BACKOFF_MS = 1000;

const MAX_BACKOFF_MS = 30_000;

/**
 * Exponential backoff for the `consecutiveFailures`-th retry, capped. `baseMs`
 * is `BASE_BACKOFF_MS` in production and injectable per supervisor — see
 * `SupervisorOptions.baseBackoffMs` for why a test needs to move it.
 */
export function backoffDelayMs(consecutiveFailures: number, baseMs: number): number {
  return Math.min(MAX_BACKOFF_MS, baseMs * 2 ** (consecutiveFailures - 1));
}

/** The two delays a supervisor retries on; both injectable per supervisor for tests. */
export interface RetryTiming { baseMs: number; unhealthyMs: number }

/** The next launch after a failed start: the fast backoff, then the slow unhealthy cadence. */
export function retryAfterFailure(consecutiveFailures: number, timing: RetryTiming): { unhealthy: boolean; delayMs: number } {
  const unhealthy = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  return { unhealthy, delayMs: unhealthy ? timing.unhealthyMs : backoffDelayMs(consecutiveFailures, timing.baseMs) };
}

/**
 * When a resident hub retries a launch that maintenance refused: when the
 * closure expects to reopen, no later than the unhealthy cadence. A closure
 * past its expected time reports 0, so the first fast backoff is the floor.
 */
export function retryAfterClosure(retryAfterMs: number | undefined, timing: RetryTiming): number {
  return Math.max(timing.baseMs, Math.min(retryAfterMs ?? timing.unhealthyMs, timing.unhealthyMs));
}

/** The one line a box's entry into the unhealthy state writes; failed slow retries stay quiet. */
export function unhealthyWarning(box: { slug: string; lastError: string | undefined }, timing: RetryTiming): string {
  const minutes = String(Math.round(timing.unhealthyMs / 60_000));
  return `[hub] ${box.slug} unhealthy after ${String(MAX_CONSECUTIVE_FAILURES)} failed starts: ${box.lastError ?? "unknown error"}; retrying every ${minutes} min (SIGHUP retries now)`;
}
