/**
 * Scheduler — daemon loop for running scheduled scripts across multiple
 * boxes. The list of boxes lives in the shared manifest at
 * `~/.config/cb/boxes.json` (see ../core/boxes-config.ts); per-box logs
 * land in `<boxRoot>/.callback-box/scheduler.jsonl` (gitignored).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_MARKER } from "../../lib/paths.js";
import { runTick, type TickResult } from "../../cli/commands/tick.js";
import { getStatus, isRepo } from "../../lib/git.js";
import { drainBoxGitLocks, GIT_DRAIN_MS } from "../../lib/git-lock.js";
import { touchSchedulerHeartbeat } from "./health-box.js";
import { measureBoxGrowthIfDue } from "../box-growth/health.js";
import { checkHealthAndAlert } from "./health-alert.js";
import { checkGoogleAuthAndAlert } from "./google-auth-alert.js";
import {
  loadBoxesConfig,
  type BoxesConfig,
} from "../box/boxes-config.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { DEV_BUNDLE_RELOAD_EXIT_CODE, devBundleWasReplaced } from "../../lib/dev-bundle-reload.js";

/** @deprecated — use `BoxesConfig` from `./boxes-config.js`. */
export type SchedulerConfig = BoxesConfig;

/** Per-box log filename inside .callback-box/ */
const SCHEDULER_LOG_FILENAME = "scheduler.jsonl";
const MAX_LOG_BYTES = 1_000_000; // 1MB

/**
 * Get the log file path for a specific box.
 */
export function boxLogFile(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", SCHEDULER_LOG_FILENAME);
}

/** @deprecated — call `loadBoxesConfig` from `./boxes-config.js` directly. */
export async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  return loadBoxesConfig();
}

/**
 * Validate that a path is a box (has .cb-box marker).
 */
export async function isBox(boxPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(boxPath, BOX_MARKER));
    return true;
  } catch (_e) {
    // access() throwing is the expected "not a box" signal (marker absent or
    // unreadable); the boolean return IS how we report it, no info to log.
    return false;
  }
}

// -- JSONL logging with rotation --

export interface LogEntry {
  ts: string;
  event: string;
  box?: string;
  result?: {
    ran: number;
    skipped: number;
    errors: number;
    /** Runs whose work completed but whose check reached no verdict. */
    inconclusive: number;
    scripts: TickResult["scripts"];
  };
  error?: string;
  [key: string]: unknown;
}

/**
 * Write a log entry to a box's .callback-box/scheduler.jsonl.
 */
async function writeBoxLog(boxRoot: string, entry: LogEntry): Promise<void> {
  const logPath = boxLogFile(boxRoot);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(logPath, line);
  await rotateLogIfNeeded(logPath);
}

async function rotateLogIfNeeded(logPath: string): Promise<void> {
  try {
    const stat = await fs.stat(logPath);
    if (stat.size <= MAX_LOG_BYTES) return;

    // Keep the last ~half of the file
    const content = await fs.readFile(logPath, "utf-8");
    const keepFrom = content.indexOf("\n", Math.floor(content.length / 2));
    if (keepFrom === -1) return;
    await fs.writeFile(logPath, content.slice(keepFrom + 1));
  } catch (e) {
    // Log rotation is best-effort: the file may not exist yet, or a concurrent
    // write may be in flight. Skipping rotation just lets the log grow a bit;
    // it does not affect scheduler operation.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`rotateLogIfNeeded: could not rotate ${logPath}:`, e);
    }
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
    await writeBoxLog(boxPath, {
      ts: new Date().toISOString(),
      event: "shutdown",
      box: boxPath,
      signal,
    }).catch(() => {});
  }

  if (!(await drainBoxGitLocks(GIT_DRAIN_MS))) {
    console.warn("Git writes were still in flight at shutdown; exiting anyway.");
  }

  process.exit(0);
}

export async function runScheduler(options?: SchedulerOptions): Promise<never> {
  const interval = (options?.intervalSeconds ?? 60) * 1000;
  let stopping = false;

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
    await shutdownScheduler(signal);
  }

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  console.log(`Scheduler started (interval: ${interval / 1000}s, pid: ${process.pid})`);

  while (!isStopping()) {
    const config = await loadSchedulerConfig();

    if (config.boxes.length === 0) {
      // No per-box log to write to when no boxes are configured
      console.error(`[${new Date().toISOString()}] No boxes configured`);
    }

    for (const boxPath of config.boxes) {
      if (isStopping()) break;
      try {
        if (!(await isBox(boxPath))) {
          console.error(`[${new Date().toISOString()}] ${boxPath}: not a valid box (missing ${BOX_MARKER})`);
          continue;
        }

        // Check for uncommitted changes before running tick
        if (await isRepo(boxPath)) {
          const status = await getStatus(boxPath);
          if (!status.clean) {
            const counts = [];
            if (status.staged.length > 0) counts.push(`${status.staged.length} staged`);
            if (status.modified.length > 0) counts.push(`${status.modified.length} modified`);
            if (status.untracked.length > 0) counts.push(`${status.untracked.length} untracked`);
            await writeBoxLog(boxPath, {
              ts: new Date().toISOString(),
              event: "dirty-repo",
              box: boxPath,
              warning: `Uncommitted changes: ${counts.join(", ")}`,
              files: [...status.staged, ...status.modified, ...status.untracked].slice(0, 20),
            });
          }
        }

        // Heartbeat before the tick: even a tick that throws proves the
        // daemon is alive (schedule-health reads this file).
        await touchSchedulerHeartbeat(boxPath);

        // Measure growth independently of the tick. A sick or unusually large
        // box is exactly when this probe may fail, and that must not prevent
        // scheduled work from getting its turn.
        try {
          const growth = await measureBoxGrowthIfDue(boxPath, { now: new Date() });
          if (growth.status === "failed") {
            await writeBoxLog(boxPath, {
              ts: new Date().toISOString(),
              event: "box-growth-scan",
              box: boxPath,
              error: growth.error,
            });
          } else if (growth.status === "measured" && growth.notice !== null) {
            await writeBoxLog(boxPath, {
              ts: new Date().toISOString(),
              event: "box-growth-scan",
              box: boxPath,
              warning: growth.notice,
            });
          }
        } catch (err) {
          try {
            await writeBoxLog(boxPath, {
              ts: new Date().toISOString(),
              event: "box-growth-scan",
              box: boxPath,
              error: errorMessage(err),
            });
          } catch (logError) {
            console.error(`[${new Date().toISOString()}] ${boxPath}: could not record box growth failure`, logError);
          }
        }

        const result = await runTick(boxPath, { quiet: true });
        await writeBoxLog(boxPath, {
          ts: new Date().toISOString(),
          event: "tick",
          box: boxPath,
          result: {
            ran: result.ranCount,
            skipped: result.skipCount,
            errors: result.errorCount,
            inconclusive: result.inconclusiveCount,
            scripts: result.scripts,
          },
        });
      } catch (err) {
        await writeBoxLog(boxPath, {
          ts: new Date().toISOString(),
          event: "tick",
          box: boxPath,
          error: errorMessage(err),
        });
      }

      try {
        const alert = await checkHealthAndAlert(boxPath, { now: new Date() });
        if (alert) {
          await writeBoxLog(boxPath, {
            ts: new Date().toISOString(),
            event: "health-alert",
            box: boxPath,
            tasks: alert.alerted,
            delivered: alert.delivered,
          });
        }
      } catch (err) {
        await writeBoxLog(boxPath, {
          ts: new Date().toISOString(),
          event: "health-alert",
          box: boxPath,
          error: errorMessage(err),
        });
      }

      // Google grant liveness: refreshes the verdict ~daily and alerts once per
      // breakage. Separate from the task-health alert above so a failure in
      // either doesn't suppress the other.
      try {
        const alert = await checkGoogleAuthAndAlert(boxPath, { now: new Date() });
        if (alert) {
          await writeBoxLog(boxPath, {
            ts: new Date().toISOString(),
            event: "google-auth-alert",
            box: boxPath,
            since: alert.alertedForSince,
            delivered: alert.delivered,
          });
        }
      } catch (err) {
        await writeBoxLog(boxPath, {
          ts: new Date().toISOString(),
          event: "google-auth-alert",
          box: boxPath,
          error: errorMessage(err),
        });
      }
    }

    // The installed launchd service owns replacement. Exit only between full
    // passes, and nonzero so KeepAlive restarts through bin/cb with a fresh
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
