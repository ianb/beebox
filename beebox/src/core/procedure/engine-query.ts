/**
 * Read-only procedure queries: listing definitions, resolving a run dir, and
 * showing a run's status. No execution or git mutation happens here.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseProcedureRun } from "../../schemas/procedure-run.js";
import { fmt } from "../../lib/format.js";
import { ok, okVoid, err, type Result } from "../../lib/result.js";
import { invariant } from "../../lib/invariant.js";
import type { CommandContext } from "../command-runner.js";
import type { ProcedureError } from "./engine-types.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { getBoxDir } from "../../lib/paths.js";

/**
 * Resolve a run-dir argument to an absolute path. A bare name or relative
 * path resolves under the box's _bookkeeping/procedure/runs/; an omitted arg picks the
 * most recent run. Returns null when no run can be located.
 */
export async function resolveRunDir(
  boxRoot: string,
  runDir: string | undefined
): Promise<string | null> {
  if (runDir !== undefined && runDir !== "") {
    return path.isAbsolute(runDir) ? runDir : path.join(boxRoot, runDir);
  }
  const runsDir = getBoxDir(boxRoot, "procedureRuns");
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    // Excludes the init-seeded `.gitkeep` (and any other stray file) — only
    // an actual run directory can be "the most recent run".
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const sorted = dirs.toSorted().toReversed();
    if (sorted.length === 0) return null;
    const [latest] = sorted;
    invariant(latest !== undefined, "sorted has at least one element (checked above)");
    return path.join(runsDir, latest);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read runs directory ${runsDir}:`, e);
    }
    return null;
  }
}

/**
 * List available procedure definitions.
 */
export async function listProcedures(ctx: CommandContext): Promise<Result<string[], ProcedureError>> {
  const procedureDir = getBoxDir(ctx.boxRoot, "procedures");

  try {
    const files = await fs.readdir(procedureDir);
    const cards = files.filter((f) => f.endsWith(".procedure.card"));

    if (cards.length === 0) {
      ctx.writeLine(fmt.dim("No procedure definitions found."));
      return ok([]);
    }

    for (const card of cards) {
      const name = card.replace(".procedure.card", "");
      ctx.writeLine(`  ${fmt.strong(name)} ${fmt.dim(card)}`);
    }

    return ok(cards);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read procedures directory ${procedureDir}:`, e);
    }
    ctx.writeLine(fmt.dim("No _config/procedures/ directory."));
    return ok([]);
  }
}

/**
 * Show status of a procedure run (defaults to the latest run).
 */
export async function procedureStatus(
  ctx: CommandContext,
  runDir?: string
): Promise<Result<void, ProcedureError>> {
  const resolved = await resolveRunDir(ctx.boxRoot, runDir);
  if (resolved === null) {
    ctx.writeLine(fmt.dim("No procedure runs found."));
    return okVoid;
  }

  const runCardPath = path.join(resolved, "run.procedure-run.card");

  try {
    const content = await fs.readFile(runCardPath, "utf-8");
    const run = parseProcedureRun(content);
    if (run === null) {
      return err({ cause: "parse", message: `Could not read run card: ${runCardPath}` });
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
      if (step.run?.error !== undefined) {
        ctx.writeLine(fmt.fail(`      ${step.run.error}`));
      }
      if (step.validate?.error !== undefined) {
        // An inconclusive check produced no verdict — say that, in the
        // warning voice, instead of printing it as a failure.
        ctx.writeLine(
          step.validate.status === "inconclusive"
            ? fmt.warn(`      ? ${step.validate.error}`)
            : fmt.fail(`      ${step.validate.error}`)
        );
      }
    }

    return okVoid;
  } catch (error) {
    return err({
      cause: "parse",
      message: `Could not read run card: ${errorMessage(error)}`,
    });
  }
}
