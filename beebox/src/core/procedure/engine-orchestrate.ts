/**
 * Run orchestration shared by startProcedure and resumeProcedure: stepping
 * through a procedure's steps and finalizing the run card once they're done.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAll, commit, withBoxGitLock } from "../../lib/git.js";
import { fmt } from "../../lib/format.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { ok, err, type Result } from "../../lib/result.js";
import type { CommandContext } from "../command-runner.js";
import {
  type ProcedureOptions,
  type ParsedProcedure,
  type ProcedureError,
  type ProcedureInconclusive,
  type ProcedureOutcome,
} from "./engine-types.js";
import { updateRunCardStatus } from "./engine-run-card.js";
import { computeRunExpires } from "./run-expiry.js";
import { executeStep } from "./engine-step.js";

export interface RunStepsResult {
  allSucceeded: boolean;
  failedStepId: string | null;
  failedStepError: string | null;
  /** Steps whose work completed but whose review reached no verdict. */
  inconclusive: ProcedureInconclusive[];
}

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
}): Promise<RunStepsResult> {
  const { ctx, boxRoot, procedure, procedureCardPath, runCardPath, relProcedurePath, options } =
    args;
  const stepsToRun = options.step
    ? procedure.steps.filter((s) => s.id === options.step)
    : options.fromStep
      ? procedure.steps.slice(
          procedure.steps.findIndex((s) => s.id === options.fromStep)
        )
      : procedure.steps;

  const inconclusive: ProcedureInconclusive[] = [];
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

    if (result.inconclusive !== undefined) inconclusive.push(result.inconclusive);

    if (result.status === "failed") {
      return {
        allSucceeded: false,
        failedStepId: step.id,
        failedStepError: result.error ?? null,
        inconclusive,
      };
    }
  }

  return { allSucceeded: true, failedStepId: null, failedStepError: null, inconclusive };
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
  result: RunStepsResult;
  /** Whether the run dir is committed. A fresh start where every step skipped
   *  is a no-op whose dir is removed; resume always passes true. */
  materialized: boolean;
}): Promise<Result<ProcedureOutcome, ProcedureError>> {
  const { ctx, boxRoot, procedure, runDir, runCardPath, result, materialized } = args;
  const { allSucceeded, failedStepId, failedStepError, inconclusive } = result;
  const procedureName = procedure.name;

  if (!materialized) {
    // No-op run: every executed step skipped, nothing was ever committed.
    await fs.rm(runDir, { recursive: true, force: true });
    ctx.writeLine(fmt.dim(`No-op run (all steps skipped) — removed ${path.relative(boxRoot, runDir)}`));
    return ok({ status: "completed", procedure: procedureName, inconclusive: [] });
  }

  const completedAt = getBoxTimeISO(boxRoot);
  // Three terminal states, not two: a run whose work all succeeded but whose
  // review never decided is neither `completed` nor `failed`.
  const status = allSucceeded
    ? inconclusive.length > 0
      ? "inconclusive"
      : "completed"
    : "failed";
  await updateRunCardStatus({
    runCardPath,
    status,
    completedAt,
    expires: computeRunExpires({ status, completedAt, procedure }),
  });
  await withBoxGitLock(boxRoot, async () => {
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `${allSucceeded ? "Complete" : "Failed"} procedure: ${procedureName}`,
      trailers: { Procedure: procedureName },
    });
  });

  if (allSucceeded) {
    if (status === "inconclusive") {
      ctx.writeLine(
        fmt.warn(
          `Procedure completed, review inconclusive: ${procedureName} (${inconclusive
            .map((i) => `${i.stepId} ${i.detail}`)
            .join("; ")})`
        )
      );
      return ok({ status: "inconclusive", procedure: procedureName, inconclusive });
    }
    ctx.writeLine(fmt.ok(`Procedure completed: ${procedureName}`));
    return ok({ status: "completed", procedure: procedureName, inconclusive: [] });
  }

  ctx.writeLine(fmt.fail(`Procedure failed: ${procedureName}`));
  return err({
    cause: "step-failed",
    message: `Procedure ${procedureName} failed at step: ${failedStepId ?? "unknown"}${failedStepError === null ? "" : ` — ${failedStepError}`}`,
  });
}
