/**
 * The retry budget for the owed `bbx wakeup`, and its terminal state.
 *
 * Why this exists: the promote worker re-arms itself whenever a pass ends
 * incomplete (`webapp/routes/scan-promote-lifecycle.ts`), and a wakeup that
 * fails for a reason that will not go away — an expired connector credential —
 * made that re-arm unbounded. Observed in production: twelve consecutive
 * passes, one full `bbx wakeup` each, roughly two minutes apart, ending only
 * when a person noticed. Nothing retries forever: the budget below bounds the
 * attempts, and exhausting it writes a durable record rather than going quiet,
 * per engineering principle 4 (resilient AND never silent).
 *
 * The decision is a pure function so the policy — not the I/O around it — is
 * what the doctest exercises.
 *
 * Neither state file ends in `.json`: `readAllQuarantineEntries` treats every
 * `.json` in the quarantine dir as a sidecar, so a `.json` name here would be
 * parsed as a scan entry.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { ensureQuarantineDir, quarantineDir } from "./quarantine.js";

/** First retry waits this long; each subsequent one doubles. Matches the
 * batch-settle window, which is the natural pace of this worker. */
const WAKEUP_RETRY_BASE_MS = 2 * 60 * 1000;

/** Doubling stops here, so a long tail stays a fixed slow poll. */
const WAKEUP_RETRY_CAP_MS = 15 * 60 * 1000;

/**
 * Failures allowed before the wakeup is abandoned. With the base and cap
 * above the retries fall at 2, 4, 8, 15 and 15 minutes — about 44 minutes of
 * trying, so a transient outage recovers on its own and a permanent one is
 * abandoned inside a working session rather than overnight.
 */
export const MAX_WAKEUP_ATTEMPTS = 6;

export type WakeupRetryDecision =
  | { kind: "retry"; delayMs: number }
  | { kind: "abandon" };

/**
 * Decide what to do after `failures` consecutive failed wakeups (counting the
 * one that just failed). Pure.
 */
export function decideWakeupRetry(failures: number): WakeupRetryDecision {
  if (failures >= MAX_WAKEUP_ATTEMPTS) return { kind: "abandon" };
  const doubled = WAKEUP_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1);
  return { kind: "retry", delayMs: Math.min(doubled, WAKEUP_RETRY_CAP_MS) };
}

const ATTEMPTS_FILENAME = "wakeup-attempts";
const ABANDONED_FILENAME = "wakeup-abandoned";

export function wakeupAttemptsPath(boxRoot: string): string {
  return path.join(quarantineDir(boxRoot), ATTEMPTS_FILENAME);
}

export function wakeupAbandonedPath(boxRoot: string): string {
  return path.join(quarantineDir(boxRoot), ABANDONED_FILENAME);
}

/**
 * Consecutive failures recorded for the owed wakeup. Durable on purpose: a
 * box that restarts mid-loop must not get a fresh budget, or a crash-restart
 * cycle reproduces the unbounded loop this module exists to stop.
 */
export async function readWakeupFailures(boxRoot: string): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(wakeupAttemptsPath(boxRoot), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return 0;
    throw e;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  // A hand-edited or truncated file reads as "no failures yet" rather than
  // throwing: the budget is a guard, and a broken guard must not take the
  // pipeline down with it.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Record one more consecutive failure and return the new count. */
export async function recordWakeupFailure(boxRoot: string): Promise<number> {
  const failures = (await readWakeupFailures(boxRoot)) + 1;
  await ensureQuarantineDir(boxRoot);
  await fs.writeFile(wakeupAttemptsPath(boxRoot), `${String(failures)}\n`);
  return failures;
}

/** Forget the failure history — the wakeup succeeded, or new work arrived. */
export async function clearWakeupFailures(boxRoot: string): Promise<void> {
  await fs.rm(wakeupAttemptsPath(boxRoot), { force: true });
}

/**
 * The terminal state: the budget is spent and no more wakeups will be
 * attempted for this marker. Written where the marker lives so the box's
 * state is visible on disk, not only in a log that rotates.
 */
export async function recordWakeupAbandoned(
  boxRoot: string,
  opts: { failures: number; detail: string },
): Promise<void> {
  await ensureQuarantineDir(boxRoot);
  const lines = [
    `${getBoxTimeISO(boxRoot)} abandoned after ${String(opts.failures)} failed wakeup(s)`,
    "The scan pipeline stopped retrying. Imported files are already in the box;",
    "what did not happen is the wakeup that drains their intake job.",
    "Fix the underlying failure, then delete this file and `wakeup-attempts` to retry.",
    "",
    `Last failure: ${opts.detail}`,
    "",
  ];
  await fs.writeFile(wakeupAbandonedPath(boxRoot), lines.join("\n"));
}

/** True when this box has already given up on the owed wakeup. */
export async function isWakeupAbandoned(boxRoot: string): Promise<boolean> {
  try {
    await fs.stat(wakeupAbandonedPath(boxRoot));
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/** Clear the terminal state — new work arrived, so the budget starts over. */
export async function clearWakeupAbandoned(boxRoot: string): Promise<void> {
  await fs.rm(wakeupAbandonedPath(boxRoot), { force: true });
}
