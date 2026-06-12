/**
 * Procedure-run garbage collection — deletes run dirs whose expiry has
 * passed. Deliberately dumb: the policy lives on each run card's `expires`
 * attribute (stamped by the engine at completion, editable by anyone to pin
 * a run); this just sweeps what's due. Git history retains every committed
 * run, so deletion loses nothing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseCard } from "cardworks";
import { commitPaths, pathsHaveChanges } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { parseDuration } from "../../schemas/scheduled-script-duration.js";
import { loadRunningProcedures } from "../schedule-state.js";
import type { CommandContext, CommandResult } from "../command-runner.js";
import { COMPLETED_RUN_EXPIRY, FAILED_RUN_EXPIRY } from "./run-expiry.js";

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
  let attrs: Record<string, string | undefined>;
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    attrs = (await parseCard(content, { source: cardPath })).attrs;
  } catch (_e) {
    // Missing or unparseable card — expire by dir age, failure-like
    const stat = await fs.stat(runDir);
    return stat.mtimeMs + parseDuration(FAILED_RUN_EXPIRY);
  }

  const expires = attrs["expires"];
  if (expires === "never") return "never";
  if (expires) {
    const at = Date.parse(expires);
    // A hand-edited, unparseable expires was an attempt to pin — keep it
    return Number.isNaN(at) ? "invalid" : at;
  }

  const status = attrs["status"];
  const defaultExpiry =
    status === "completed" ? COMPLETED_RUN_EXPIRY : FAILED_RUN_EXPIRY;
  const baseline =
    Date.parse(attrs["completed-at"] ?? "") ||
    Date.parse(attrs["started-at"] ?? "") ||
    (await fs.stat(runDir)).mtimeMs;
  return baseline + parseDuration(defaultExpiry);
}

/**
 * Delete expired run dirs under procedure/runs/. Always keeps the newest
 * run per procedure (`cb procedure status` reads it) and anything still
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
  const newestPerProcedure = new Map<string, string>();
  for (const dirName of dirNames) {
    const procName = procedureNameOf(dirName);
    const newest = newestPerProcedure.get(procName);
    if (!newest || dirName > newest) {
      newestPerProcedure.set(procName, dirName);
    }
  }

  const now = Date.now();
  const removed: string[] = [];
  for (const dirName of dirNames) {
    if (running.has(dirName)) continue;
    if (newestPerProcedure.get(procedureNameOf(dirName)) === dirName) continue;

    const runDir = path.join(runsDir, dirName);
    const expiry = await resolveExpiry(runDir);
    if (expiry === "never") continue;
    if (expiry === "invalid") {
      ctx.writeLine(fmt.warn(`Unparseable expires on ${dirName} — keeping`));
      continue;
    }
    if (expiry > now) continue;

    await fs.rm(runDir, { recursive: true, force: true });
    removed.push(dirName);
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
