/**
 * bbx activity - Report whether any box is doing work a restart would interrupt:
 * running scheduled scripts, running procedures, or an active chat turn.
 *
 * Reads on-disk locks across every configured box (boxes.json), so it works
 * cross-process — no in-memory server state needed. The daily recycle timer and
 * the deploy's pre-restart wait-for-quiet both poll this to avoid killing
 * active work.
 *
 * Exit 0 = at rest. Exit 1 = busy, with one blocker per line on stdout.
 */

import { Command } from "commander";
import { loadBoxesConfig } from "../../core/box/boxes-config.js";
import { loadRunningScripts } from "../../core/schedule/state.js";
import { findBusyBlockers } from "./tick-helpers.js";

export const activityCommand = new Command("activity")
  .description("Report in-flight work across all boxes (exit 1 if busy); gates restarts/recycles")
  .action(async () => {
    const { boxes } = await loadBoxesConfig();
    const blockers: string[] = [];
    for (const boxRoot of boxes) {
      // loadRunningScripts reads on-disk script locks (PID-liveness checked);
      // findBusyBlockers folds in running procedures and active chat locks.
      const running = await loadRunningScripts(boxRoot);
      for (const blocker of await findBusyBlockers(boxRoot, running)) {
        blockers.push(`${boxRoot}: ${blocker}`);
      }
    }

    if (blockers.length === 0) {
      console.log("at rest");
      return;
    }
    console.log(blockers.join("\n"));
    process.exitCode = 1;
  });
