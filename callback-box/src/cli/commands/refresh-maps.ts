/**
 * cb refresh-maps — orchestrate the daily MAP.md refresh.
 *
 * Three modes:
 *
 *   cb refresh-maps              Print a one-line summary of pending work.
 *                                Exits 0 if work is needed (with brief saved
 *                                for a later --finalize), exits CHECK_SKIP_CODE
 *                                (75) when there's nothing to do or the box is
 *                                in an unworkable state (uncommitted, no repo,
 *                                no commits).
 *
 *   cb refresh-maps --brief      Same gating, but stdout is the JSON brief that
 *                                the agent consumes.
 *
 *   cb refresh-maps --finalize   Read the persisted brief, ensure per-dir
 *                                CLAUDE.md @-includes, stamp the state file for
 *                                the maps that were actually rewritten. Runs as
 *                                a procedure run-phase shell, so it executes
 *                                even when the agent errored or ran out of
 *                                turns — that's what makes a partial run bank
 *                                its progress. A missing brief is a no-op, not
 *                                an error.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { isRecord } from "../../lib/is-record.js";
import { precheck, type MapBrief, type MapTask } from "../../core/maps/precheck.js";
import { finalize } from "../../core/maps/finalize.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

const BRIEF_FILE = path.join(".callback-box", "refresh-maps-brief.json");

/**
 * The cached brief carries a usable task list when it has a `tasks` array.
 * Task internals are trusted — we wrote the file.
 *
 * Only `tasks` is read back, never the whole {@link MapBrief}: finalize needs
 * nothing else, and a brief written by an earlier version (before `anomalies`
 * existed) would not satisfy the full shape. Reading the narrow thing keeps
 * that one-run transition window from discarding a run's work.
 */
function briefTasks(value: unknown): MapTask[] | null {
  if (!isRecord(value)) return null;
  const tasks = value["tasks"];
  return Array.isArray(tasks) ? tasks : null;
}

async function saveBrief(boxRoot: string, brief: MapBrief): Promise<void> {
  const dir = path.join(boxRoot, ".callback-box");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(boxRoot, BRIEF_FILE),
    JSON.stringify(brief, null, 2) + "\n",
  );
}

async function readSavedBriefTasks(boxRoot: string): Promise<MapTask[] | null> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, BRIEF_FILE), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return briefTasks(parsed);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("refresh-maps: could not read saved brief, treating as absent:", e);
    }
    return null;
  }
}

async function deleteSavedBrief(boxRoot: string): Promise<void> {
  try {
    await fs.unlink(path.join(boxRoot, BRIEF_FILE));
  } catch (_e) {
    // Best-effort cleanup: the brief is already gone (never written, or
    // deleted by a prior run), which is the desired end state regardless.
  }
}

function summarize(brief: MapBrief): string {
  const counts = { create: 0, update: 0 };
  for (const task of brief.tasks) {
    counts[task.action] += 1;
  }
  const base = `${brief.tasks.length} map(s) need work (${counts.create} create, ${counts.update} update)`;
  if (brief.anomalies.length === 0) return base;
  const dirs = brief.anomalies.map((a) => a.dir || "<root>").join(", ");
  return `${base}; ${brief.anomalies.length} anomaly/anomalies: unresolvable asOf for ${dirs}`;
}

interface RunOptions {
  brief?: boolean;
  finalize?: boolean;
}

async function runFinalize(boxRoot: string): Promise<void> {
  const tasks = await readSavedBriefTasks(boxRoot);
  if (!tasks) {
    // No brief is a no-op, not a failure. This runs as a procedure run-phase
    // shell, which executes even when the run agent died before saving one —
    // and a non-zero run shell fails the whole step regardless of the step's
    // validate severity. "Nothing to bank" must not gate the procedure.
    console.log("refresh-maps: no saved brief; nothing to finalize.");
    return;
  }
  const result = await finalize({ boxRoot, tasks });
  await deleteSavedBrief(boxRoot);
  console.log(`refresh-maps: finalized ${result.applied.length}/${tasks.length} map(s).`);
  if (result.skippedUnchanged.length > 0) {
    console.log(
      `  ${result.skippedUnchanged.length} task(s) left for a later run — MAP.md unchanged: ` +
        result.skippedUnchanged.map((d) => d || "<root>").join(", "),
    );
  }
  if (result.skippedMissingMap.length > 0) {
    console.log(
      `  ${result.skippedMissingMap.length} task(s) skipped — MAP.md not written: ` +
        result.skippedMissingMap.map((d) => d || "<root>").join(", "),
    );
  }
  if (result.skippedMissingDir.length > 0) {
    console.log(
      `  ${result.skippedMissingDir.length} task(s) skipped — directory deleted: ` +
        result.skippedMissingDir.map((d) => d || "<root>").join(", "),
    );
  }
}

async function runCheck(boxRoot: string, options: RunOptions): Promise<void> {
  const brief = await precheck({ boxRoot });

  if (!brief.needsWork) {
    const reason = brief.skippedReason ?? "nothing to do";
    if (options.brief) {
      console.log(JSON.stringify(brief, null, 2));
    } else {
      console.log(`refresh-maps: ${reason}`);
    }
    process.exit(CHECK_SKIP_CODE);
  }

  await saveBrief(boxRoot, brief);

  if (options.brief) {
    console.log(JSON.stringify(brief, null, 2));
  } else {
    console.log(`refresh-maps: ${summarize(brief)}`);
  }
}

export const refreshMapsCommand = new Command("refresh-maps")
  .description("Refresh the box's MAP.md files")
  .option("--brief", "Output the JSON brief (for agent consumption)")
  .option("--finalize", "Run the post-agent finalize step")
  .action(async (options: RunOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      if (options.finalize) {
        await runFinalize(boxRoot);
      } else {
        await runCheck(boxRoot, options);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
