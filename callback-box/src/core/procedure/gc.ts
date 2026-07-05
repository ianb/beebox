/**
 * Procedure-run garbage collection — deletes run dirs whose expiry has
 * passed, and caps each procedure at MAX_RUNS_PER_PROCEDURE retained dirs
 * regardless of expiry (a backstop against a procedure that fails/completes
 * every tick and would otherwise accrete faster than the age clock reclaims).
 * Deliberately dumb: the policy lives on each run card's `expires` attribute
 * (stamped by the engine at completion, editable by anyone to pin a run); this
 * sweeps what's due and trims the per-procedure overflow. Git history retains
 * every committed run, so deletion loses nothing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseProcedureRun } from "../../schemas/procedure-run.js";
import { commitPaths, pathsHaveChanges } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { parseDuration } from "../../schemas/scheduled-script-duration.js";
import { loadRunningProcedures } from "../schedule-state.js";
import type { CommandContext, CommandResult } from "../command-runner.js";
import { COMPLETED_RUN_EXPIRY, FAILED_RUN_EXPIRY, MAX_RUNS_PER_PROCEDURE } from "./run-expiry.js";

const RUN_DIR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{4}$/;

/** Procedure name from a `<name>_<YYYY-MM-DDTHHMM>` run dir name. */
function procedureNameOf(dirName: string): string {
  const sep = dirName.lastIndexOf("_");
  if (sep > 0 && RUN_DIR_TIMESTAMP.test(dirName.slice(sep + 1))) {
    return dirName.slice(0, sep);
  }
  return dirName;
}

/**
 * When a run dir may be deleted, as epoch ms — or "never"/"invalid" to keep
 * it. Legacy cards without `expires` get the status-based default from
 * their completion time; crashed runs (non-terminal status) and unreadable
 * cards are failure-like and get the failed default from the best available
 * timestamp.
 */
async function resolveExpiry(runDir: string): Promise<number | "never" | "invalid"> {
  const cardPath = path.join(runDir, "run.procedure-run.card");
  let run;
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    run = parseProcedureRun(content);
  } catch (_e) {
    run = null;
  }
  if (run === null) {
    // Missing or unparseable card — expire by dir age, failure-like
    const stat = await fs.stat(runDir);
    return stat.mtimeMs + parseDuration(FAILED_RUN_EXPIRY);
  }

  const expires = run.expires;
  if (expires === "never") return "never";
  if (expires !== undefined) {
    const at = Date.parse(expires);
    // A hand-edited, unparseable expires was an attempt to pin — keep it
    return Number.isNaN(at) ? "invalid" : at;
  }

  const defaultExpiry =
    run.status === "completed" ? COMPLETED_RUN_EXPIRY : FAILED_RUN_EXPIRY;
  const baseline =
    Date.parse(run["completed-at"] ?? "") ||
    Date.parse(run["started-at"]) ||
    (await fs.stat(runDir)).mtimeMs;
  return baseline + parseDuration(defaultExpiry);
}

/**
 * Delete expired run dirs under procedure/runs/, plus per-procedure overflow
 * past MAX_RUNS_PER_PROCEDURE (oldest first). Always keeps the newest run per
 * procedure (`cb procedure status` reads it), pinned runs, and anything still
 * running. Commits once when it deleted something; silent when not.
 */
export async function gcProcedureRuns(ctx: CommandContext): Promise<CommandResult> {
  const { boxRoot } = ctx;
  const runsDir = path.join(boxRoot, "procedure/runs");

  let dirNames: string[];
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read runs directory ${runsDir}:`, e);
    }
    return { success: true, data: { removed: [] } };
  }

  const running = new Set(await loadRunningProcedures(boxRoot));

  // Group by procedure so both "keep newest" and the per-procedure cap can be
  // evaluated per group, newest first (dir names end in a sortable timestamp).
  const byProcedure = new Map<string, string[]>();
  for (const dirName of dirNames) {
    const procName = procedureNameOf(dirName);
    const list = byProcedure.get(procName);
    if (list) list.push(dirName);
    else byProcedure.set(procName, [dirName]);
  }

  const now = Date.now();
  const removed: string[] = [];
  for (const dirs of byProcedure.values()) {
    dirs.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)); // newest first
    // Count of dirs this procedure keeps so far; a run is cap-evicted once the
    // group is already holding MAX_RUNS_PER_PROCEDURE, oldest first.
    let kept = 0;
    for (const [i, dirName] of dirs.entries()) {
      if (running.has(dirName)) {
        kept++;
        continue;
      }
      if (i === 0) {
        kept++; // newest per procedure is always kept (cb procedure status reads it)
        continue;
      }
      const runDir = path.join(runsDir, dirName);
      const expiry = await resolveExpiry(runDir);
      if (expiry === "never") {
        kept++;
        continue;
      }
      if (expiry === "invalid") {
        ctx.writeLine(fmt.warn(`Unparseable expires on ${dirName} — keeping`));
        kept++;
        continue;
      }
      const expired = expiry <= now;
      const overCap = kept >= MAX_RUNS_PER_PROCEDURE;
      if (!expired && !overCap) {
        kept++;
        continue;
      }
      await fs.rm(runDir, { recursive: true, force: true });
      removed.push(dirName);
    }
  }

  if (removed.length > 0) {
    // Untracked dirs (crash debris that never materialized) leave no git
    // change, so only commit when the deletion touched tracked files
    if (await pathsHaveChanges(boxRoot, ["procedure/runs"])) {
      await commitPaths(boxRoot, {
        paths: ["procedure/runs"],
        message: `GC procedure runs: removed ${removed.length} expired run dir(s)`,
        trailers: { "Commit-Source": "procedure-gc" },
      });
    }
    ctx.writeLine(fmt.ok(`Removed ${removed.length} expired run dir(s)`));
  }

  return { success: true, data: { removed } };
}
