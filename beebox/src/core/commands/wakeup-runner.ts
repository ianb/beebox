/**
 * The shape of "run a `bbx wakeup` child and tell me what it did".
 *
 * Separate from `wakeup.ts` so the injection point (`Services.wakeupRunner`)
 * can be typed without the services container importing the command-runner
 * registration side of that module.
 */

import type { WakeupOutcomeReport } from "../../cli/commands/wakeup-outcome.js";

export interface WakeupRunResult {
  /** The child exited zero. Says nothing about which step did what — read
   * `outcome` for that. */
  ok: boolean;
  /** Empty on a clean run; otherwise one sentence about what went wrong. */
  detail: string;
  /** The child's combined output, for a caller that explicitly asked. */
  output: string;
  /** The typed account of the cycle, or null when the child produced none. */
  outcome: WakeupOutcomeReport | null;
}

/**
 * `core/commands/wakeup.ts`'s `runBbxWakeup`, as a type a test can substitute
 * for. Spawning a real `bbx` child is the one part of the forced-wakeup path a
 * test cannot usefully run, and it is the part with nothing to verify.
 */
export type WakeupRunner = (opts: {
  boxRoot: string;
  triggeredBy: string;
  connector?: string | undefined;
}) => Promise<WakeupRunResult>;
