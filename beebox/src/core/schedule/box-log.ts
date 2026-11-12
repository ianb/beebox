/** A box's scheduler log, `.beebox/scheduler.jsonl`: JSONL with rotation. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TickResult } from "../../cli/commands/tick.js";
import { errnoCode } from "../../shared/error-guards.js";

const SCHEDULER_LOG_FILENAME = "scheduler.jsonl";
const MAX_LOG_BYTES = 1_000_000; // 1MB

export function boxLogFile(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", SCHEDULER_LOG_FILENAME);
}

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

export async function writeBoxLog(boxRoot: string, entry: LogEntry): Promise<void> {
  const logPath = boxLogFile(boxRoot);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, JSON.stringify(entry) + "\n");
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
