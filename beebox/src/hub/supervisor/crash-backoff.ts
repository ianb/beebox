/**
 * The crash-loop retry policy for hub-supervised boxes — how many consecutive
 * failed launches a box gets, and how long to wait before each retry.
 *
 * Split from `supervisor.ts` for its 300-line cap, the same way `child-env.ts`
 * and `child-spawn.ts` were, and it stands on its own: this is the policy, and
 * `supervisor.ts` is the machinery that applies it.
 */

/**
 * After this many consecutive crash-loop restarts, stop retrying and mark the
 * box unhealthy until `reloadUnhealthy()` (SIGHUP) is called. No precedent in
 * router.ts (worktrees don't self-restart) — chosen per the plan's explicit
 * "pick N=5 unless you find a better precedent" guidance.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

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
