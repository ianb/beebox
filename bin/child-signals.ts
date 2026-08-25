/**
 * Passing a signal to a spawned child and waiting for it to actually go.
 *
 * Extracted from bin/test-ledger.ts so bin/with-slot.ts holds a machine-wide
 * slot under the same rules: a wrapper that dies without taking its child down
 * hands the semaphore to a run that then contends with the very process the
 * signal was aimed at.
 *
 * See issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md and
 * callback-box/docs/plans/change-based-test-selection.md, mechanism A.
 */

import type { ChildProcess } from "node:child_process";

/** How long a signalled child gets to exit on its own before SIGKILL. */
export const CHILD_EXIT_GRACE_MS = 10_000;

/**
 * Pass a signal to a running child and wait for it to actually go.
 *
 * Bounded twice over: SIGKILL after the grace period, and giving up on the
 * wait shortly after that. A signal handler that never returns is a process
 * that never dies, which is worse than a slot released a moment early.
 */
export async function terminateChild(input: {
  child: ChildProcess;
  signal: NodeJS.Signals;
  graceMs?: number;
}): Promise<void> {
  const { child } = input;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const graceMs = input.graceMs ?? CHILD_EXIT_GRACE_MS;
  child.kill(input.signal);
  await new Promise<void>((resolve) => {
    const forced = setTimeout(() => child.kill("SIGKILL"), graceMs);
    const abandoned = setTimeout(() => {
      clearTimeout(forced);
      resolve();
    }, graceMs * 2);
    child.once("close", () => {
      clearTimeout(forced);
      clearTimeout(abandoned);
      resolve();
    });
  });
}

/**
 * 128+signum, the shell convention for a signal death. Collapsing it to a bare
 * 1 would make a killed run indistinguishable from ordinary failures.
 */
export function signalNumber(signal: NodeJS.Signals): number {
  const known: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGABRT: 6, SIGKILL: 9,
    SIGALRM: 14, SIGTERM: 15,
  };
  return known[signal] ?? 0;
}
