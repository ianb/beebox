/**
 * Single-step execution for the procedure engine: precheck, run (agents +
 * shells), validation, git-clean enforcement, and result recording.
 */

import { stageAll, commit } from "../../lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { getBoxTimeISO } from "../../cli/lib/time.js";
import type { CommandContext } from "../command-runner.js";
import {
  type AgentFactory,
  type ParsedStep,
  type ParsedProcedure,
  type StepUpdate,
} from "./engine-types.js";
import { updateStepInRunCard } from "./engine-run-card.js";
import { executePhaseShells } from "./engine-phase.js";
import { runAndValidate, type ValidateOutcome, type RunShellFailure } from "./engine-run-phase.js";

/**
 * Parameters for executeStep
 */
export interface ExecuteStepParams {
  ctx: CommandContext;
  boxRoot: string;
  step: ParsedStep;
  procedure: ParsedProcedure;
  procedureCardPath: string;
  runCardPath: string;
  relProcedurePath: string;
  /**
   * Commit the run's start the first time a step does something non-skip.
   * Until this fires the run dir is untracked, so an all-skip run can be
   * removed without leaving git history (see startProcedure).
   */
  ensureMaterialized: () => Promise<void>;
  directive?: string;
  createAgent?: AgentFactory;
}

/**
 * Execute a single procedure step.
 *
 * Returns "completed", "skipped", or "failed".
 */
export async function executeStep(
  params: ExecuteStepParams
): Promise<"completed" | "skipped" | "failed"> {
  const { ctx, step, runCardPath } = params;

  ctx.writeLine(fmt.phase(`Step: ${step.id}`));
  ctx.writeLine(fmt.dim(step.description));
  ctx.writeLine("");

  // Update run card: step is now running (uncommitted signal)
  await updateStepInRunCard({
    runCardPath,
    stepId: step.id,
    update: {
      status: "running",
      startedAt: getBoxTimeISO(ctx.boxRoot),
    },
  });

  // ── Precheck ──
  const precheck = await runPrecheck(params);
  if (precheck.outcome !== "continue") {
    return precheck.outcome;
  }

  // This step is going to do something — the run now persists
  await params.ensureMaterialized();

  // ── Run ──
  if (!step.run) {
    await recordNoRunPhase(params);
    return "completed";
  }

  // ── Run + validate (with severity:review auto-retry) ──
  const { gitRef, sessionId, runStdout, validateResult, reviewExhausted, runFailure } =
    await runAndValidate({
      ...params,
      precheckOutput: precheck.output,
    });

  // ── Record results ──
  return recordStepResults({
    params,
    gitRef,
    sessionId,
    runStdout,
    validateResult,
    reviewExhausted,
    runFailure,
  });
}

type PrecheckOutcome =
  | { outcome: "skipped" | "failed" }
  | { outcome: "continue"; output: string | undefined };

/**
 * Run the precheck phase and emit/commit any skip or fail state.
 */
async function runPrecheck(params: ExecuteStepParams): Promise<PrecheckOutcome> {
  const { ctx, boxRoot, step, procedure, runCardPath } = params;
  if (!step.precheck) {
    return { outcome: "continue", output: undefined };
  }

  ctx.writeLine(fmt.dim("  Precheck..."));
  const precheckResult = await executePhaseShells(boxRoot, step.precheck);

  if (precheckResult.skipped) {
    ctx.writeLine(fmt.dim(`  Skipped: ${precheckResult.stdout || "precheck exit $CHECK_SKIP"}`));
    // Card update only, no commit — if every step skips, the whole run dir
    // is removed at completion; if a later step does work, the skip history
    // rides along in that step's "Start procedure" commit.
    await updateStepInRunCard({
      runCardPath,
      stepId: step.id,
      update: {
        status: "skipped",
        precheck: { status: "skip", stdout: precheckResult.stdout },
      },
    });
    ctx.writeLine("");
    return { outcome: "skipped" };
  }

  if (precheckResult.exitCode !== 0) {
    await params.ensureMaterialized();
    ctx.writeLine(fmt.fail(`Precheck failed (exit ${precheckResult.exitCode})`));
    if (precheckResult.stderr) {
      ctx.writeLine(fmt.dim(`  ${precheckResult.stderr}`));
    }
    await updateStepInRunCard({
      runCardPath,
      stepId: step.id,
      update: {
        status: "failed",
        precheck: { status: "fail", stdout: precheckResult.stdout },
        completedAt: getBoxTimeISO(boxRoot),
      },
    });
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `[procedure] Failed step: ${step.id} (precheck)`,
      trailers: { Procedure: procedure.name, Step: step.id },
    });
    ctx.writeLine("");
    return { outcome: "failed" };
  }

  ctx.writeLine(fmt.ok(`Precheck passed${precheckResult.stdout ? `: ${precheckResult.stdout}` : ""}`));

  const output =
    step.precheck.passOutput && precheckResult.stdout ? precheckResult.stdout : undefined;
  return { outcome: "continue", output };
}

/**
 * Record completion for a step that has no run phase defined.
 */
async function recordNoRunPhase(params: ExecuteStepParams): Promise<void> {
  const { ctx, boxRoot, step, procedure, runCardPath } = params;
  ctx.writeLine(fmt.warn("  No run phase defined"));
  await updateStepInRunCard({
    runCardPath,
    stepId: step.id,
    update: {
      status: "completed",
      completedAt: getBoxTimeISO(boxRoot),
    },
  });
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `[procedure] Complete step: ${step.id}`,
    trailers: { Procedure: procedure.name, Step: step.id },
  });
  ctx.writeLine("");
}

/**
 * Parameters for recordStepResults
 */
interface RecordStepResultsParams {
  params: ExecuteStepParams;
  gitRef: string;
  sessionId: string | undefined;
  runStdout: string | undefined;
  validateResult: ValidateOutcome | undefined;
  /** A `severity: review` failure that couldn't be healed — fails the step. */
  reviewExhausted: boolean;
  /** A non-zero exit from a run-phase shell — fails the step objectively. */
  runFailure: RunShellFailure | undefined;
}

/**
 * Build the final step update, persist it, commit, and report.
 */
async function recordStepResults(
  args: RecordStepResultsParams
): Promise<"completed" | "failed"> {
  const { params, gitRef, sessionId, runStdout, validateResult, reviewExhausted, runFailure } = args;
  const { ctx, boxRoot, step, procedure, runCardPath } = params;

  // A step fails when a run shell exited non-zero, when an `abort` validation
  // failed, or when a `review` failure exhausted its retries (the auto-retry in
  // runAndValidate makes review gate).
  const validationGated =
    validateResult?.status === "fail" && step.validate?.severity === "abort";
  const stepUpdate: StepUpdate = {
    status: runFailure !== undefined || validationGated || reviewExhausted ? "failed" : "completed",
    completedAt: getBoxTimeISO(boxRoot),
  };

  if (step.precheck) {
    stepUpdate.precheck = { status: "pass", stdout: "" };
  }

  const runResult: NonNullable<StepUpdate["run"]> = { gitRef };
  if (sessionId) {
    runResult.sessionId = sessionId;
  }
  if (runStdout) {
    runResult.stdout = runStdout;
  }
  if (runFailure) {
    // Capture the failure detail (exit code + both streams) in the run card so
    // `cb procedure status` and later inspection show why the step failed.
    const detail = [runFailure.stdout, runFailure.stderr].filter(Boolean).join("\n");
    runResult.stdout = `Shell command failed (exit ${runFailure.exitCode})${detail ? `:\n${detail}` : ""}`;
  }
  stepUpdate.run = runResult;

  if (validateResult) {
    const valUpdate: NonNullable<StepUpdate["validate"]> = {
      status: validateResult.status,
    };
    if (validateResult.stdout) {
      valUpdate.stdout = validateResult.stdout;
    }
    if (validateResult.review) {
      valUpdate.review = validateResult.review;
    }
    stepUpdate.validate = valUpdate;
  }

  const succeeded = stepUpdate.status !== "failed";

  await updateStepInRunCard({ runCardPath, stepId: step.id, update: stepUpdate });
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `[procedure] ${succeeded ? "Complete" : "Failed"} step: ${step.id}`,
    trailers: { Procedure: procedure.name, Step: step.id },
  });

  if (succeeded) {
    ctx.writeLine(fmt.ok(`Step completed: ${step.id}`));
  } else {
    ctx.writeLine(fmt.fail(`Step failed: ${step.id}`));
  }
  ctx.writeLine("");

  return succeeded ? "completed" : "failed";
}
