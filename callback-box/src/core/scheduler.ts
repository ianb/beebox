/**
 * Scheduler — daemon loop for running scheduled scripts across multiple
 * boxes. The list of boxes lives in the shared manifest at
 * `~/.config/cb/boxes.json` (see ../core/boxes-config.ts); per-box logs
 * land in `<boxRoot>/.callback-box/scheduler.jsonl` (gitignored).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { BOX_MARKER } from "../cli/lib/paths.js";
import { runTick, type TickResult } from "../cli/commands/tick.js";
import { getStatus, isRepo } from "../cli/lib/git.js";
import {
  loadBoxesConfig,
  saveBoxesConfig,
  type BoxesConfig,
} from "./boxes-config.js";

/** @deprecated — use `BoxesConfig` from `./boxes-config.js`. */
export type SchedulerConfig = BoxesConfig;

/** Per-box log filename inside .callback-box/ */
export const SCHEDULER_LOG_FILENAME = "scheduler.jsonl";
const MAX_LOG_BYTES = 1_000_000; // 1MB

/** For backwards compat and the CLI status command */
export const LOG_DIR = path.join(os.homedir(), ".local/share/cb");

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

/** @deprecated — call `saveBoxesConfig` from `./boxes-config.js` directly. */
export async function saveSchedulerConfig(config: SchedulerConfig): Promise<void> {
  await saveBoxesConfig(config);
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
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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
export async function runScheduler(options?: SchedulerOptions): Promise<never> {
  const interval = (options?.intervalSeconds ?? 60) * 1000;
  let stopping = false;

  async function shutdown(signal: string) {
    console.log(`[${new Date().toISOString()}] Scheduler received ${signal}, shutting down...`);
    stopping = true;

    // Log shutdown to each box
    const config = await loadSchedulerConfig().catch(() => ({ boxes: [] as string[] }));
    for (const boxPath of config.boxes) {
      await writeBoxLog(boxPath, {
        ts: new Date().toISOString(),
        event: "shutdown",
        box: boxPath,
        signal,
      }).catch(() => {});
    }

    process.exit(0);
  }

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  console.log(`Scheduler started (interval: ${interval / 1000}s, pid: ${process.pid})`);

  while (!stopping) {
    const config = await loadSchedulerConfig();

    if (config.boxes.length === 0) {
      // No per-box log to write to when no boxes are configured
      console.error(`[${new Date().toISOString()}] No boxes configured`);
    }

    for (const boxPath of config.boxes) {
      if (stopping) break;
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

        const result = await runTick(boxPath, { quiet: true });
        await writeBoxLog(boxPath, {
          ts: new Date().toISOString(),
          event: "tick",
          box: boxPath,
          result: {
            ran: result.ranCount,
            skipped: result.skipCount,
            errors: result.errorCount,
            scripts: result.scripts,
          },
        });
      } catch (err) {
        await writeBoxLog(boxPath, {
          ts: new Date().toISOString(),
          event: "tick",
          box: boxPath,
          error: (err as Error).message,
        });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  // Unreachable, but satisfies return type
  process.exit(0);
  return undefined as never;
}
