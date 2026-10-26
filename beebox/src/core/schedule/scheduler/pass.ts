/**
 * One scheduler pass over one box: admission, the dirty-repo note, the
 * heartbeat, the growth probe, the tick, the alerts, each landing in the
 * box's own `.beebox/scheduler.jsonl`.
 *
 * Extracted from the daemon loop (`./core.ts`) so a unit host can run it as
 * the box's user, inside the box sandbox, through `bbx engine scheduler pass
 * <boxRoot>` in `beebox-pass@<slug>.service` (docs/implemented-plans/per-box-units.md,
 * Track E). On a machine without units the daemon calls it in process.
 */

import { withBoxWork } from "../../../lib/box-maintenance/admission.js";
import { BoxMaintenanceError } from "../../../lib/box-maintenance-error.js";
import { isBoxRoot } from "../../../lib/box-identity.js";
import { runTick } from "../../../cli/commands/tick.js";
import { getStatus, isRepo } from "../../../lib/git/core/operations.js";
import { touchSchedulerHeartbeat } from "../health-box.js";
import { measureBoxGrowthIfDue } from "../../box-growth/health.js";
import { runBoxAlerts } from "./box-alerts.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { refreshHubMeta } from "../../hub-meta.js";
import { writeBoxLog } from "./box-log.js";

export type PassOutcome = "ran" | "not-a-box" | "maintenance";

/**
 * Run the pass under fresh admission. `"maintenance"` means the box is closed
 * for maintenance and the pass was deferred, an ordinary outcome, not a
 * failure; anything else that throws is the daemon's to report.
 */
export async function runSchedulerPass(boxPath: string): Promise<PassOutcome> {
  try {
    return await withBoxWork({ boxRoot: boxPath, reason: "scheduler pass" }, () => passBody(boxPath));
  } catch (error) {
    if (error instanceof BoxMaintenanceError) return "maintenance";
    throw error;
  }
}

async function passBody(boxPath: string): Promise<PassOutcome> {
  const stamp = () => new Date().toISOString();
  try {
    if (!(await isBoxRoot(boxPath))) {
      console.error(`[${stamp()}] ${boxPath}: not a valid box (needs package.json declaring beebox and _config/)`);
      return "not-a-box";
    }

    // A hand edit of box.json or a token file since the last engine run
    // reaches the hub's metadata within a minute on a host that schedules.
    refreshHubMeta(boxPath);

    // Check for uncommitted changes before running tick
    if (await isRepo(boxPath)) {
      const status = await getStatus(boxPath);
      if (!status.clean) {
        const counts = [];
        if (status.staged.length > 0) counts.push(`${status.staged.length} staged`);
        if (status.modified.length > 0) counts.push(`${status.modified.length} modified`);
        if (status.untracked.length > 0) counts.push(`${status.untracked.length} untracked`);
        await writeBoxLog(boxPath, {
          ts: stamp(),
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
        await writeBoxLog(boxPath, { ts: stamp(), event: "box-growth-scan", box: boxPath, error: growth.error });
      } else if (growth.status === "measured" && growth.notice !== null) {
        await writeBoxLog(boxPath, { ts: stamp(), event: "box-growth-scan", box: boxPath, warning: growth.notice });
      }
    } catch (err) {
      try {
        await writeBoxLog(boxPath, { ts: stamp(), event: "box-growth-scan", box: boxPath, error: errorMessage(err) });
      } catch (logError) {
        console.error(`[${stamp()}] ${boxPath}: could not record box growth failure`, logError);
      }
    }

    const result = await runTick(boxPath, { quiet: true });
    await writeBoxLog(boxPath, {
      ts: stamp(),
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
    await writeBoxLog(boxPath, { ts: stamp(), event: "tick", box: boxPath, error: errorMessage(err) });
  }

  await runBoxAlerts(boxPath, (entry) => writeBoxLog(boxPath, { ...entry, box: boxPath }));
  return "ran";
}
