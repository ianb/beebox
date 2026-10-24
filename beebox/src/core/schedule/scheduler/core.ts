/**
 * Scheduler — daemon loop for running scheduled scripts across multiple
 * boxes. The list of boxes lives in the shared manifest at
 * `~/.config/beebox/boxes.json` (see ../core/boxes-config.ts); per-box logs
 * land in `<boxRoot>/.beebox/scheduler.jsonl` (gitignored).
 */

import { withBoxWork } from "../../../lib/box-maintenance/admission.js";
import { isBoxRoot } from "../../../lib/box-identity.js";
import { drainBoxGitLocks, GIT_DRAIN_MS } from "../../../lib/git-lock.js";
import {
  loadBoxesConfig,
  type BoxesConfig,
} from "../../box/boxes-config.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { DEV_BUNDLE_RELOAD_EXIT_CODE, devBundleWasReplaced } from "../../../lib/dev-bundle-reload.js";
import { writeBoxLog } from "./box-log.js";
import { runSchedulerPass } from "./pass.js";
import { boxRunWrapperPresent, runPassThroughWrapper, slugForBoxRoot } from "./box-run.js";

// The per-box log moved to `./box-log.ts` and the pass itself to `./pass.ts`;
// re-exported so the CLI (`cli/commands/scheduler`) keeps one import.
export { boxLogFile, type LogEntry } from "./box-log.js";
export { runSchedulerPass } from "./pass.js";

/** @deprecated — use `BoxesConfig` from `./boxes-config.js`. */
export type SchedulerConfig = BoxesConfig;

/** @deprecated — call `loadBoxesConfig` from `./boxes-config.js` directly. */
export async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  return loadBoxesConfig();
}

/**
 * Validate that a path is a box: a `package.json` declaring `beebox` beside
 * `_config/` (`isBoxRoot`). A broken `package.json` there throws.
 */
export async function isBox(boxPath: string): Promise<boolean> {
  return isBoxRoot(boxPath);
}

/**
 * `isBox` for one entry of a list: a check that throws (an unparseable
 * `package.json` beside `_config/`) becomes that entry's problem, so the
 * listing goes on to the next box. Returns null for a box.
 */
export async function boxEntryProblem(boxPath: string): Promise<string | null> {
  try {
    return (await isBoxRoot(boxPath)) ? null : "not a box: needs package.json declaring beebox and _config/";
  } catch (e) {
    return errorMessage(e);
  }
}

// -- Daemon loop --

export interface SchedulerOptions {
  intervalSeconds?: number;
}

/**
 * Run the scheduler daemon loop. Polls each configured box every interval.
 * Reloads config each cycle so boxes can be added/removed without restart.
 */
/**
 * Signal teardown: record the shutdown in every box's log, let in-flight git
 * finish, and exit.
 *
 * The drain is the part that matters. A scheduled task's whole job is usually
 * to write and commit; exiting on top of an in-flight `git commit` orphans it
 * into systemd's cgroup SIGKILL, and a git killed mid-index-write leaves a
 * `.git/index.lock` that blocks every writer in that box until a human removes
 * it (`lib/git-stale-lock.ts`). Bounded, and a drain that does not finish is a
 * warning rather than a refusal to exit — a shutdown that hangs is worse.
 */
async function shutdownScheduler(signal: string): Promise<never> {
  console.log(`[${new Date().toISOString()}] Scheduler received ${signal}, shutting down...`);

  const config = await loadSchedulerConfig().catch((): SchedulerConfig => ({ boxes: [] }));
  for (const boxPath of config.boxes) {
    await withBoxWork({ boxRoot: boxPath, reason: "scheduler shutdown log" }, () => writeBoxLog(boxPath, {
      ts: new Date().toISOString(),
      event: "shutdown",
      box: boxPath,
      signal,
    })).catch(() => {});
  }

  if (!(await drainBoxGitLocks(GIT_DRAIN_MS))) {
    console.warn("Git writes were still in flight at shutdown; exiting anyway.");
  }

  process.exit(0);
}

export async function runScheduler(options?: SchedulerOptions): Promise<never> {
  const interval = (options?.intervalSeconds ?? 60) * 1000;
  let stopping = false;
  let currentPass: Promise<void> | undefined;

  // Indirection so TS doesn't narrow `stopping` to its literal initializer
  // `false` at the read sites below — its only assignment lives inside
  // `shutdown`, invoked asynchronously via a signal handler that TS's
  // control-flow analysis can't see as a reachable mutation. The two reads
  // below are load-bearing: they're how the main loop notices a signal fired.
  function isStopping(): boolean {
    return stopping;
  }

  async function shutdown(signal: string) {
    stopping = true;
    // The loop owns failure reporting; shutdown only waits for accepted work.
    await currentPass?.catch(() => {});
    await shutdownScheduler(signal);
  }

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  const throughWrapper = await boxRunWrapperPresent();
  console.log(`Scheduler started (interval: ${interval / 1000}s, pid: ${process.pid}${throughWrapper ? ", passes through bbx-box-run" : ""})`);

  while (!isStopping()) {
    const config = await loadSchedulerConfig();

    if (config.boxes.length === 0) {
      // No per-box log to write to when no boxes are configured
      console.error(`[${new Date().toISOString()}] No boxes configured`);
    }

    for (const boxPath of config.boxes) {
      if (isStopping()) break;
      // Each pass, including heartbeat, growth and credential housekeeping,
      // gets fresh admission. No daemon-wide permit survives into a later tick.
      // On a unit host the pass runs as the box's user inside its sandbox,
      // through the one root path the scheduler user may call; elsewhere in
      // process (docs/plans/per-box-units.md, Track E).
      currentPass = throughWrapper
        ? runPassThroughWrapper(slugForBoxRoot(boxPath)).catch((error: unknown) => {
          console.error(`[${new Date().toISOString()}] ${boxPath}: pass failed: ${errorMessage(error)}`);
        })
        : runSchedulerPass(boxPath).then(() => { /* the pass logs its own outcome in the box */ });
      try {
        await currentPass;
      } finally {
        currentPass = undefined;
      }
    }

    // The installed launchd service owns replacement. Exit only between full
    // passes, and nonzero so KeepAlive restarts through bin/bbx with a fresh
    // artifact stamp. A foreground scheduler exits visibly instead of risking
    // two concurrent daemons by trying to spawn its own successor.
    if (await devBundleWasReplaced()) {
      console.log(`[${new Date().toISOString()}] Development bundle changed; restarting scheduler after completed pass.`);
      process.exit(DEV_BUNDLE_RELOAD_EXIT_CODE);
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  // `process.exit` is typed `never`, so this terminates the `Promise<never>`
  // return without a synthetic `return … as never`.
  process.exit(0);
}
