/**
 * Server process lifecycle helpers — box resolution and previous-process
 * cleanup. Split out of server.ts to keep that file under its line budget.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { requireBoxRoot } from "../lib/paths.js";
import type { BoxSpec, ServerOptions } from "./server-types.js";

/**
 * Build the boxes array from either the explicit `boxes` option or the
 * legacy single `boxRoot` option (falling back to the ambient box root).
 */
export async function resolveBoxes(options: ServerOptions): Promise<BoxSpec[]> {
  if (options.boxes && options.boxes.length > 0) {
    return options.boxes;
  }
  const boxRoot = options.boxRoot ?? await requireBoxRoot();
  return [{ slug: path.basename(boxRoot), boxRoot }];
}

/**
 * Kill any previous server process using the PID file.
 */
export async function killPreviousServer(pidFile: string): Promise<void> {
  try {
    const pidStr = await fs.promises.readFile(pidFile, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (isNaN(pid)) return;

    try {
      // Check if process is alive (signal 0 doesn't kill, just checks)
      process.kill(pid, 0);
      console.log(`Killing previous server (PID ${pid})...`);
      process.kill(pid, "SIGTERM");
      // Give it a moment to shut down
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        process.kill(pid, 0);
        // Still alive, force kill
        console.log(`Force killing previous server (PID ${pid})...`);
        process.kill(pid, "SIGKILL");
      } catch (_e) {
        // kill(pid, 0) threw — process already exited between SIGTERM and now. Good.
      }
    } catch (_e) {
      // kill(pid, 0) threw — process doesn't exist, stale PID file. Nothing to kill.
    }

    await fs.promises.unlink(pidFile).catch(() => {});
  } catch (_e) {
    // readFile threw — no PID file (or unreadable). No previous server to kill.
  }
}
