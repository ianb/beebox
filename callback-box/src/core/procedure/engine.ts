/**
 * Procedure engine — executes procedure definitions step by step.
 *
 * Loads a procedure definition card, creates a run directory with a run card,
 * executes steps sequentially, records results, and maintains git-clean state
 * between steps. Run orchestration (runSteps/finalizeRun) lives in
 * engine-orchestrate.ts; read-only queries in engine-query.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseProcedureRun } from "../../schemas/procedure-run.js";
import { stageAll, commit, withBoxGitLock } from "../../lib/git.js";
import { fmt } from "../../lib/format.js";
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import { okVoid, err, type Result } from "../../lib/result.js";
import type { CommandContext } from "../command-runner.js";
import { type ProcedureOptions, type ParsedProcedure, type ProcedureError } from "./engine-types.js";
import { loadProcedureDefinition } from "./engine-parse.js";
import { buildInitialRunCard, updateRunCardStatus } from "./engine-run-card.js";
import { runSteps, finalizeRun } from "./engine-orchestrate.js";
import { resolveRunDir } from "./engine-query.js";
import { errorMessage } from "../../lib/error-guards.js";

export type { AgentFactory } from "./engine-types.js";
export type { ProcedureOptions, ProcedureError } from "./engine-types.js";

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
 * Start a new procedure run.
 */
export async function startProcedure(
  params: StartProcedureParams
): Promise<Result<void, ProcedureError>> {
  const { ctx, procedureNameOrPath, options = {} } = params;
  const { boxRoot } = ctx;

  const procedureCardPath = resolveProcedureCardPath(boxRoot, procedureNameOrPath);

  try {
    await fs.access(procedureCardPath);
  } catch (e) {
    console.warn(`Procedure definition not accessible at ${procedureCardPath}:`, e);
    return err({
      cause: "not-found",
      message: `Procedure definition not found: ${procedureCardPath}`,
    });
  }

  // Parse procedure definition
  const procedure = await loadProcedureDefinition(procedureCardPath);
  const procedureName = procedure.name;

  if (options.dryRun) {
    printDryRun({ ctx, procedure, directive: options.directive });
    return okVoid;
  }

  // Validate --step if provided
  if (options.step) {
    const found = procedure.steps.find((s) => s.id === options.step);
    if (!found) {
      const validIds = procedure.steps.map((s) => s.id).join(", ");
      return err({
        cause: "not-found",
        message: `Unknown step "${options.step}". Available steps: ${validIds}`,
      });
    }
  }

  // Create run directory. Domain time (getBoxTime) so a scenario test's frozen
  // clock produces a deterministic run-dir name.
  const timestamp = getBoxTime(boxRoot)
    .toISOString()
    .replace(/[.:]/g, "")
    .replace("T", "T")
    .slice(0, 15);
  const runDirName = `${procedureName}_${timestamp}`;
  const runDir = path.join(boxRoot, "procedure/runs", runDirName);
  await fs.mkdir(runDir, { recursive: true });

  const runCardPath = path.join(runDir, "run.procedure-run.card");

  // Generate initial run card
  const now = getBoxTimeISO(boxRoot);
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
    // One locked span: a writer must not stage between our stageAll and our
    // commit, or its files land under this procedure's attribution.
    await withBoxGitLock(boxRoot, async () => {
      await stageAll(boxRoot);
      await commit(boxRoot, {
        message: `Start procedure: ${procedureName}`,
        trailers: { Procedure: procedureName },
      });
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

  return finalizeRun({
    ctx,
    boxRoot,
    procedure,
    runDir,
    runCardPath,
    result: { allSucceeded, failedStepId },
    materialized,
  });
}

/**
 * Resume a failed (or interrupted) procedure run from its first
 * not-yet-completed step, reusing the existing run dir and card. Earlier
 * completed/skipped steps are not re-run.
 */
export async function resumeProcedure(params: {
  ctx: CommandContext;
  runDir?: string;
  options?: ProcedureOptions;
}): Promise<Result<void, ProcedureError>> {
  const { ctx, options = {} } = params;
  const { boxRoot } = ctx;

  const runDir = await resolveRunDir(boxRoot, params.runDir);
  if (runDir === null) {
    return err({ cause: "resume", message: "No procedure run found to resume." });
  }
  const runCardPath = path.join(runDir, "run.procedure-run.card");

  let run;
  try {
    run = parseProcedureRun(await fs.readFile(runCardPath, "utf-8"));
  } catch (e) {
    return err({ cause: "parse", message: `Could not read run card: ${errorMessage(e)}` });
  }
  if (run === null) {
    return err({ cause: "parse", message: `Could not parse run card: ${runCardPath}` });
  }

  const relRunDir = path.relative(boxRoot, runDir);
  if (run.status === "completed") {
    ctx.writeLine(fmt.ok(`Run already completed: ${relRunDir} — nothing to resume`));
    return okVoid;
  }

  // Resume index: the first step that is neither completed nor skipped (both
  // are terminal-success and never re-run). Since execution halts at the first
  // failure, this is the failed step, and everything after it is pending.
  const resumeStep = run.steps.find((s) => s.status !== "completed" && s.status !== "skipped");
  if (resumeStep === undefined) {
    ctx.writeLine(fmt.ok(`All steps already completed: ${relRunDir} — nothing to resume`));
    return okVoid;
  }

  // Load the procedure definition the run was created from.
  const procedureCardPath = path.isAbsolute(run.procedure)
    ? run.procedure
    : path.join(boxRoot, run.procedure);
  try {
    await fs.access(procedureCardPath);
  } catch (e) {
    console.warn(`Procedure definition not accessible at ${procedureCardPath}:`, e);
    return err({ cause: "not-found", message: `Procedure definition not found: ${procedureCardPath}` });
  }
  const procedure = await loadProcedureDefinition(procedureCardPath);

  // The resume step must still exist in the (possibly edited) definition.
  if (!procedure.steps.some((s) => s.id === resumeStep.id)) {
    return err({
      cause: "resume",
      message: `Step "${resumeStep.id}" no longer exists in procedure definition: ${run.procedure}`,
    });
  }

  // Re-open the run: it's active again (the on-disk "running" signal).
  await updateRunCardStatus({ runCardPath, status: "running" });

  ctx.writeLine(fmt.header(`Resuming procedure: ${procedure.name}`));
  ctx.writeLine(fmt.dim(`Run: ${relRunDir}`));
  ctx.writeLine(fmt.dim(`From step: ${resumeStep.id}`));
  ctx.writeLine("");

  // The run dir already has commits, so materialization is a no-op.
  const ensureMaterialized = (): Promise<void> => Promise.resolve();

  const resumeOptions: ProcedureOptions = { ...options, fromStep: resumeStep.id };
  if (run.directive !== undefined && resumeOptions.directive === undefined) {
    resumeOptions.directive = run.directive;
  }

  const { allSucceeded, failedStepId } = await runSteps({
    ctx,
    boxRoot,
    procedure,
    procedureCardPath,
    runCardPath,
    relProcedurePath: run.procedure,
    options: resumeOptions,
    ensureMaterialized,
  });

  return finalizeRun({
    ctx,
    boxRoot,
    procedure,
    runDir,
    runCardPath,
    result: { allSucceeded, failedStepId },
    materialized: true,
  });
}
