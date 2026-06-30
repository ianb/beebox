/**
 * Read-only procedure queries: listing definitions, resolving a run dir, and
 * showing a run's status. No execution or git mutation happens here.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseProcedureRun } from "../../schemas/procedure-run.js";
import { fmt } from "../../cli/lib/format.js";
import type { CommandContext, CommandResult } from "../command-runner.js";

/**
 * Resolve a run-dir argument to an absolute path. A bare name or relative
 * path resolves under the box's procedure/runs/; an omitted arg picks the
 * most recent run. Returns null when no run can be located.
 */
export async function resolveRunDir(
  boxRoot: string,
  runDir: string | undefined
): Promise<string | null> {
  if (runDir !== undefined && runDir !== "") {
    return path.isAbsolute(runDir) ? runDir : path.join(boxRoot, runDir);
  }
  const runsDir = path.join(boxRoot, "procedure/runs");
  try {
    const dirs = await fs.readdir(runsDir);
    const sorted = dirs.toSorted().toReversed();
    return sorted.length === 0 ? null : path.join(runsDir, sorted[0]!);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read runs directory ${runsDir}:`, e);
    }
    return null;
  }
}

/**
 * List available procedure definitions.
 */
export async function listProcedures(ctx: CommandContext): Promise<CommandResult> {
  const procedureDir = path.join(ctx.boxRoot, "config/procedures");

  try {
    const files = await fs.readdir(procedureDir);
    const cards = files.filter((f) => f.endsWith(".procedure.card"));

    if (cards.length === 0) {
      ctx.writeLine(fmt.dim("No procedure definitions found."));
      return { success: true, data: [] };
    }

    for (const card of cards) {
      const name = card.replace(".procedure.card", "");
      ctx.writeLine(`  ${fmt.strong(name)} ${fmt.dim(card)}`);
    }

    return { success: true, data: cards };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read procedures directory ${procedureDir}:`, e);
    }
    ctx.writeLine(fmt.dim("No config/procedures/ directory."));
    return { success: true, data: [] };
  }
}

/**
 * Show status of a procedure run (defaults to the latest run).
 */
export async function procedureStatus(
  ctx: CommandContext,
  runDir?: string
): Promise<CommandResult> {
  const resolved = await resolveRunDir(ctx.boxRoot, runDir);
  if (resolved === null) {
    ctx.writeLine(fmt.dim("No procedure runs found."));
    return { success: true };
  }

  const runCardPath = path.join(resolved, "run.procedure-run.card");

  try {
    const content = await fs.readFile(runCardPath, "utf-8");
    const run = parseProcedureRun(content);
    if (run === null) {
      return { success: false, error: `Could not read run card: ${runCardPath}` };
    }

    ctx.writeLine(fmt.header(`Procedure Run: ${run.procedure}`));
    ctx.writeLine(fmt.kv("Status", fmt.status(run.status)));
    ctx.writeLine(fmt.kv("Started", run["started-at"]));
    if (run["completed-at"] !== undefined) {
      ctx.writeLine(fmt.kv("Completed", run["completed-at"]));
    }
    ctx.writeLine("");

    for (const step of run.steps) {
      const status = step.status;
      const icon =
        status === "completed"
          ? fmt.success("✓")
          : status === "skipped"
            ? fmt.dim("○")
            : status === "failed"
              ? fmt.error("✗")
              : status === "running"
                ? fmt.warn("▸")
                : fmt.dim("·");
      ctx.writeLine(`  ${icon} ${fmt.strong(step.id)} ${fmt.dim(`(${status})`)}`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Could not read run card: ${(error as Error).message}`,
    };
  }
}
