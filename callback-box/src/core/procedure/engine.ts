/**
 * Procedure engine — executes procedure definitions step by step.
 *
 * Loads a procedure definition card, creates a run directory with a run card,
 * executes steps sequentially, records results, and maintains git-clean state
 * between steps.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseProcedureRun } from "../../schemas/procedure-run.js";
import { stageAll, commit } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import type { CommandContext, CommandResult } from "../command-runner.js";
import { type ProcedureOptions, type ParsedProcedure } from "./engine-types.js";
import { loadProcedureDefinition } from "./engine-parse.js";
import { buildInitialRunCard, updateRunCardStatus } from "./engine-run-card.js";
import { computeRunExpires } from "./run-expiry.js";
import { executeStep } from "./engine-step.js";

export type { AgentFactory } from "./engine-types.js";
export type { ProcedureOptions } from "./engine-types.js";

/**
 * Parameters for startProcedure
 */
export interface StartProcedureParams {
  ctx: CommandContext;
  procedureNameOrPath: string;
  options?: ProcedureOptions;
}

/**
 * Resolve a procedure definition path from a bare name or a path.
 */
function resolveProcedureCardPath(boxRoot: string, procedureNameOrPath: string): string {
  if (
    procedureNameOrPath.endsWith(".procedure.card") ||
    procedureNameOrPath.includes("/")
  ) {
    // Treat as a path (absolute or relative to boxRoot)
    return path.isAbsolute(procedureNameOrPath)
      ? procedureNameOrPath
      : path.join(boxRoot, procedureNameOrPath);
  }
  // Bare name → config/procedures/<name>.procedure.card
  return path.join(
    boxRoot,
    "config/procedures",
    `${procedureNameOrPath}.procedure.card`
  );
}

/**
 * Print the dry-run summary of a procedure's steps.
 */
function printDryRun(args: {
  ctx: CommandContext;
  procedure: ParsedProcedure;
  directive: string | undefined;
}): void {
  const { ctx, procedure, directive } = args;
  ctx.writeLine(fmt.header(`Procedure: ${procedure.name}`));
  ctx.writeLine(fmt.dim(procedure.description));
  if (directive) {
    ctx.writeLine(fmt.kv("Directive", directive));
  }
  ctx.writeLine("");
  for (const step of procedure.steps) {
    const hasPrecheck = step.precheck !== undefined;
    const hasValidate = step.validate !== undefined;
    const runType = step.run?.agents.length
      ? "agent"
      : step.run?.shells.length
        ? "shell"
        : "none";
    ctx.writeLine(
      `  ${fmt.strong(step.id)}: ${step.description} ${fmt.dim(`[${runType}${hasPrecheck ? ", precheck" : ""}${hasValidate ? ", validate" : ""}]`)}`
    );
  }
}

/**
 * Run a procedure's steps in sequence, returning the failed step id if any.
 */
async function runSteps(args: {
  ctx: CommandContext;
  boxRoot: string;
  procedure: ParsedProcedure;
  procedureCardPath: string;
  runCardPath: string;
  relProcedurePath: string;
  options: ProcedureOptions;
  ensureMaterialized: () => Promise<void>;
}): Promise<{ allSucceeded: boolean; failedStepId: string | null }> {
  const { ctx, boxRoot, procedure, procedureCardPath, runCardPath, relProcedurePath, options } =
    args;
  const stepsToRun = options.step
    ? procedure.steps.filter((s) => s.id === options.step)
    : procedure.steps;

  for (const step of stepsToRun) {
    const result = await executeStep({
      ctx,
      boxRoot,
      step,
      procedure,
      procedureCardPath,
      runCardPath,
      relProcedurePath,
      ensureMaterialized: args.ensureMaterialized,
      ...(options.directive && { directive: options.directive }),
      ...(options.createAgent && { createAgent: options.createAgent }),
    });

    if (result === "failed") {
      return { allSucceeded: false, failedStepId: step.id };
    }
  }

  return { allSucceeded: true, failedStepId: null };
}

/**
 * Start a new procedure run.
 */
export async function startProcedure(
  params: StartProcedureParams
): Promise<CommandResult> {
  const { ctx, procedureNameOrPath, options = {} } = params;
  const { boxRoot } = ctx;

  const procedureCardPath = resolveProcedureCardPath(boxRoot, procedureNameOrPath);

  try {
    await fs.access(procedureCardPath);
  } catch (e) {
    console.warn(`Procedure definition not accessible at ${procedureCardPath}:`, e);
    return {
      success: false,
      error: `Procedure definition not found: ${procedureCardPath}`,
    };
  }

  // Parse procedure definition
  const procedure = await loadProcedureDefinition(procedureCardPath);
  const procedureName = procedure.name;

  if (options.dryRun) {
    printDryRun({ ctx, procedure, directive: options.directive });
    return { success: true };
  }

  // Validate --step if provided
  if (options.step) {
    const found = procedure.steps.find((s) => s.id === options.step);
    if (!found) {
      const validIds = procedure.steps.map((s) => s.id).join(", ");
      return {
        success: false,
        error: `Unknown step "${options.step}". Available steps: ${validIds}`,
      };
    }
  }

  // Create run directory
  const timestamp = new Date()
    .toISOString()
    .replace(/[.:]/g, "")
    .replace("T", "T")
    .slice(0, 15);
  const runDirName = `${procedureName}_${timestamp}`;
  const runDir = path.join(boxRoot, "procedure/runs", runDirName);
  await fs.mkdir(runDir, { recursive: true });

  const runCardPath = path.join(runDir, "run.procedure-run.card");

  // Generate initial run card
  const now = new Date().toISOString();
  const relProcedurePath = path.relative(boxRoot, procedureCardPath);
  const initialRunCard = buildInitialRunCard({ procedure, procedurePath: relProcedurePath, startedAt: now, ...(options.directive && { directive: options.directive }) });
  await fs.writeFile(runCardPath, initialRunCard);

  // The on-disk card is the "procedure is running" signal (see
  // loadRunningProcedures), but the start commit is deferred until a step
  // actually does something — a run where every step skips is a no-op whose
  // dir is removed below, leaving no git trace. Provenance for no-op ticks
  // lives in scheduler.jsonl.
  let materialized = false;
  const ensureMaterialized = async (): Promise<void> => {
    if (materialized) return;
    materialized = true;
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `Start procedure: ${procedureName}`,
      trailers: { Procedure: procedureName },
    });
  };

  ctx.writeLine(fmt.header(`Starting procedure: ${procedure.name}`));
  ctx.writeLine(fmt.dim(`Run: ${path.relative(boxRoot, runDir)}`));
  ctx.writeLine("");

  // Execute steps (optionally filtered to a single step)
  const { allSucceeded, failedStepId } = await runSteps({
    ctx,
    boxRoot,
    procedure,
    procedureCardPath,
    runCardPath,
    relProcedurePath,
    options,
    ensureMaterialized,
  });

  if (!materialized) {
    // No-op run: every executed step skipped, nothing was ever committed.
    await fs.rm(runDir, { recursive: true, force: true });
    ctx.writeLine(fmt.dim(`No-op run (all steps skipped) — removed ${path.relative(boxRoot, runDir)}`));
    return { success: true };
  }

  // Final run card update
  const completedAt = new Date().toISOString();
  const status = allSucceeded ? "completed" : "failed";
  await updateRunCardStatus({
    runCardPath,
    status,
    completedAt,
    expires: computeRunExpires({ status, completedAt, procedure }),
  });
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `${allSucceeded ? "Complete" : "Failed"} procedure: ${procedureName}`,
    trailers: { Procedure: procedureName },
  });

  if (allSucceeded) {
    ctx.writeLine(fmt.ok(`Procedure completed: ${procedureName}`));
  } else {
    ctx.writeLine(fmt.fail(`Procedure failed: ${procedureName}`));
  }

  return {
    success: allSucceeded,
    ...(!allSucceeded && { error: `Procedure ${procedureName} failed at step: ${failedStepId ?? "unknown"}` }),
  };
}

/**
 * List available procedure definitions.
 */
export async function listProcedures(
  ctx: CommandContext
): Promise<CommandResult> {
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
 * Show status of a procedure run.
 */
export async function procedureStatus(
  ctx: CommandContext,
  runDir?: string
): Promise<CommandResult> {
  const { boxRoot } = ctx;

  // If no run dir specified, find the latest
  if (!runDir) {
    const runsDir = path.join(boxRoot, "procedure/runs");
    try {
      const dirs = await fs.readdir(runsDir);
      const sorted = dirs.toSorted().toReversed();
      if (sorted.length === 0) {
        ctx.writeLine(fmt.dim("No procedure runs found."));
        return { success: true };
      }
      runDir = path.join(runsDir, sorted[0]!);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Could not read runs directory ${runsDir}:`, e);
      }
      ctx.writeLine(fmt.dim("No procedure/runs/ directory."));
      return { success: true };
    }
  }

  const runCardPath = path.join(
    runDir.startsWith("/") ? runDir : path.join(boxRoot, runDir),
    "run.procedure-run.card"
  );

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
