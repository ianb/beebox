/**
 * One sweep across every configured target, plus the settle-retry policy.
 *
 * Deliberately NOT in `cli.ts`: that module ends with a top-level `void run()`,
 * so importing anything from it also runs the uploader. Tests (and any future
 * caller) need this logic without that side effect.
 */

import type { TargetConfig, UploaderConfig } from "./config.js";
import { errorMessage } from "./error-guards.js";
import { runTarget, type RunOptions, type RunSummary } from "./run-target.js";
import { SETTLE_WINDOW_MS } from "./settle.js";
import { sleep } from "./sleep.js";

/**
 * How many times a run comes back for files the settle gate skipped, and how
 * long it waits before each retry.
 *
 * The launchd agent fires on `WatchPaths` as well as on its interval, so a run
 * routinely starts the instant a file appears — inside the settle window, when
 * the scanner may still be writing. Without this, that run would skip the file
 * and nothing would retry it until the next filesystem event or the next
 * interval sweep, which is exactly the latency the watch exists to remove.
 *
 * Bounded on purpose: three rounds covers a scanner still flushing a multi-page
 * PDF, and anything slower is left to the interval sweep rather than held here
 * indefinitely. Holding the run open longer would also start overlapping the
 * next scheduled invocation.
 */
const MAX_SETTLE_RETRIES = 3;
const SETTLE_RETRY_WAIT_MS = SETTLE_WINDOW_MS + 2_000;

/** Seams for the doctest: real runs use `runTarget` and a real sleep, the test
 * substitutes a scripted runner and a no-op wait so it can assert the retry
 * policy without spending the settle window. */
export interface RunAllDeps {
  readonly runOne: (target: TargetConfig, options: RunOptions) => Promise<RunSummary>;
  readonly wait: (ms: number) => Promise<void>;
}

const DEFAULT_RUN_ALL_DEPS: RunAllDeps = { runOne: runTarget, wait: sleep };

export interface RunAllOptions extends RunOptions {
  /** Omitted in production; the doctest supplies scripted seams. */
  readonly deps?: RunAllDeps;
}

export function printSummary(target: TargetConfig, summary: RunSummary): void {
  console.log(
    `${target.folder}: uploaded=${String(summary.uploaded)} duplicate=${String(summary.duplicate)} ` +
      `rejected=${String(summary.rejected)} skipped-unsettled=${String(summary.skippedUnsettled)} ` +
      `skipped-identity-changed=${String(summary.skippedIdentityChanged)} errors=${String(summary.errors)}`,
  );
}

function hasFailure(summary: RunSummary): boolean {
  return summary.rejected > 0 || summary.errors > 0;
}

/**
 * A target whose folder is missing or unreadable fails that target alone.
 *
 * `listCandidateFiles` throws straight out of `readdir` (ENOENT on a renamed
 * or unmounted folder, EACCES on a permissions change), and one throw used to
 * abandon the whole run — so a stale first target meant the second never swept
 * at all. The run reports the failure, exits non-zero, and keeps going.
 */
export async function runAllTargets(config: UploaderConfig, options: RunAllOptions): Promise<number> {
  const deps = options.deps ?? DEFAULT_RUN_ALL_DEPS;
  const runOptions: RunOptions = { retryRejected: options.retryRejected };
  let exitCode = 0;
  let pending: readonly TargetConfig[] = config.targets;
  for (let round = 0; ; round++) {
    const unsettled: TargetConfig[] = [];
    for (const target of pending) {
      let summary: RunSummary;
      try {
        summary = await deps.runOne(target, runOptions);
      } catch (e) {
        console.error(`${target.folder}: ${errorMessage(e)}`);
        exitCode = 1;
        continue;
      }
      printSummary(target, summary);
      if (hasFailure(summary)) exitCode = 1;
      if (summary.skippedUnsettled > 0) unsettled.push(target);
    }
    if (unsettled.length === 0 || round >= MAX_SETTLE_RETRIES) return exitCode;
    await deps.wait(SETTLE_RETRY_WAIT_MS);
    pending = unsettled;
  }
}
