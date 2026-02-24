/**
 * Scheduler — config management and daemon loop for running scheduled scripts
 * across multiple boxes.
 *
 * Config lives at ~/.config/cb/scheduler.json (machine-local, not per-box).
 * Per-box logs are written to <boxRoot>/.callback-box/scheduler.jsonl (gitignored).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { BOX_MARKER } from "../cli/lib/paths.js";
import { runTick, type TickResult } from "../cli/commands/tick.js";
import { getStatus, isRepo } from "../cli/lib/git.js";

export interface SchedulerConfig {
  boxes: string[];
}

const CONFIG_DIR = path.join(os.homedir(), ".config/cb");
const CONFIG_FILE = path.join(CONFIG_DIR, "scheduler.json");

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

export async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as SchedulerConfig;
  } catch {
    return { boxes: [] };
  }
}

export async function saveSchedulerConfig(config: SchedulerConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Validate that a path is a box (has .cb-box marker).
 */
export async function isBox(boxPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(boxPath, BOX_MARKER));
    return true;
  } catch {
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
  } catch {
    // File may not exist yet
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

  console.log(`Scheduler started (interval: ${interval / 1000}s)`);

  while (true) {
    const config = await loadSchedulerConfig();

    if (config.boxes.length === 0) {
      // No per-box log to write to when no boxes are configured
      console.error(`[${new Date().toISOString()}] No boxes configured`);
    }

    for (const boxPath of config.boxes) {
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
}
