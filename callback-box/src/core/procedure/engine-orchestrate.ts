/**
 * Run orchestration shared by startProcedure and resumeProcedure: stepping
 * through a procedure's steps and finalizing the run card once they're done.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAll, commit } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { okVoid, err, type Result } from "../../lib/result.js";
import type { CommandContext } from "../command-runner.js";
import { type ProcedureOptions, type ParsedProcedure, type ProcedureError } from "./engine-types.js";
import { updateRunCardStatus } from "./engine-run-card.js";
import { computeRunExpires } from "./run-expiry.js";
import { executeStep } from "./engine-step.js";

/**
 * Run a procedure's steps in sequence, returning the failed step id if any.
 * `options.step` runs exactly one step; `options.fromStep` runs that step and
 * every step after it (resume); otherwise every step runs.
 */
export async function runSteps(args: {
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
    : options.fromStep
      ? procedure.steps.slice(
          procedure.steps.findIndex((s) => s.id === options.fromStep)
        )
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
 * Finalize a run after its steps have executed: handle the no-op case,
 * stamp the run card's terminal status + expiry, commit, and report.
 * Shared by startProcedure and resumeProcedure.
 */
export async function finalizeRun(args: {
  ctx: CommandContext;
  boxRoot: string;
  procedure: ParsedProcedure;
  runDir: string;
  runCardPath: string;
  result: { allSucceeded: boolean; failedStepId: string | null };
  /** Whether the run dir is committed. A fresh start where every step skipped
   *  is a no-op whose dir is removed; resume always passes true. */
  materialized: boolean;
}): Promise<Result<void, ProcedureError>> {
  const { ctx, boxRoot, procedure, runDir, runCardPath, result, materialized } = args;
  const { allSucceeded, failedStepId } = result;
  const procedureName = procedure.name;

  if (!materialized) {
    // No-op run: every executed step skipped, nothing was ever committed.
    await fs.rm(runDir, { recursive: true, force: true });
    ctx.writeLine(fmt.dim(`No-op run (all steps skipped) — removed ${path.relative(boxRoot, runDir)}`));
    return okVoid;
  }

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
    return okVoid;
  }

  ctx.writeLine(fmt.fail(`Procedure failed: ${procedureName}`));
  return err({
    cause: "step-failed",
    message: `Procedure ${procedureName} failed at step: ${failedStepId ?? "unknown"}`,
  });
}
