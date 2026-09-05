/**
 * Single-step execution for the procedure engine: precheck, run (agents +
 * shells), validation, git-clean enforcement, and result recording.
 */

import { stageAll, commit, withBoxGitLock } from "../../lib/git.js";
import { fmt } from "../../lib/format.js";
import { getBoxTimeISO } from "../../lib/time.js";
import type { CommandContext } from "../command-runner.js";
import {
  type AgentFactory,
  type ParsedStep,
  type ParsedProcedure,
  type StepUpdate,
  type ProcedureInconclusive,
} from "./engine-types.js";
import { updateStepInRunCard } from "./engine-run-card.js";
import { executePhaseShells } from "./engine-phase.js";
import { runAndValidate, type ValidateOutcome } from "./engine-run-phase.js";
import type { RunShellFailure } from "./engine-run-execute.js";
import { formatInconclusiveValidateError } from "../../shared/inconclusive.js";

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

export interface StepExecutionResult {
  status: "completed" | "skipped" | "failed";
  /** Root cause to carry through the procedure/CLI boundary when known. */
  error?: string;
  /**
   * Set when the step's work completed but its review reached no verdict.
   * The step is NOT failed — reporting a non-answer as a failure is what
   * sent readers to redo work that was already correct — but the run says
   * so, all the way out to `bbx health`.
   */
  inconclusive?: ProcedureInconclusive;
}

/**
 * Execute a single procedure step.
 *
 * Returns "completed", "skipped", or "failed".
 */
export async function executeStep(
  params: ExecuteStepParams
): Promise<StepExecutionResult> {
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
    return { status: precheck.outcome };
  }

  // This step is going to do something — the run now persists
  await params.ensureMaterialized();

  // ── Run ──
  if (!step.run) {
    await recordNoRunPhase(params);
    return { status: "completed" };
  }

  // ── Run + validate (with severity:review auto-retry) ──
  const {
    gitRef,
    sessionId,
    runStdout,
    validateResult,
    reviewExhausted,
    runFailure,
    engineUnavailable,
    invocationFailure,
  } =
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
    engineUnavailable,
    invocationFailure,
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
    await withBoxGitLock(boxRoot, async () => {
      await stageAll(boxRoot);
      await commit(boxRoot, {
        message: `[procedure] Failed step: ${step.id} (precheck)`,
        trailers: { Procedure: procedure.name, Step: step.id },
      });
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
  await withBoxGitLock(boxRoot, async () => {
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `[procedure] Complete step: ${step.id}`,
      trailers: { Procedure: procedure.name, Step: step.id },
    });
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
  /** A deferred-recoverable engine failure (quota exhausted) — fails the
   * step with the informative message; retrying later can succeed. */
  engineUnavailable: string | undefined;
  /** Native harness failed without a usable assistant response. */
  invocationFailure: string | undefined;
}

function buildRunUpdate(args: RecordStepResultsParams): NonNullable<StepUpdate["run"]> {
  const {
    gitRef,
    sessionId,
    runStdout,
    runFailure,
    engineUnavailable,
    invocationFailure,
    validateResult,
  } = args;
  const runResult: NonNullable<StepUpdate["run"]> = { gitRef };
  if (sessionId) runResult.sessionId = sessionId;
  if (runStdout) runResult.stdout = runStdout;
  if (runFailure !== undefined) {
    const detail = [runFailure.stdout, runFailure.stderr].filter(Boolean).join("\n");
    runResult.stdout = `Shell command failed (exit ${runFailure.exitCode})${detail ? `:\n${detail}` : ""}`;
  }
  if (engineUnavailable !== undefined) runResult.stdout = engineUnavailable;

  const errors: string[] = [];
  if (invocationFailure !== undefined && validateResult?.invocationFailure === undefined) {
    errors.push(invocationFailure);
  }
  if (engineUnavailable !== undefined && !errors.includes(engineUnavailable)) {
    errors.push(engineUnavailable);
  }
  if (runFailure !== undefined) errors.push(`Shell command failed (exit ${runFailure.exitCode})`);
  if (errors.length > 0) runResult.error = errors.join("\n");
  return runResult;
}

/**
 * Persist the validate phase. `error` carries the concrete reason a check
 * didn't reach a verdict — a harness failure, or (for an inconclusive check)
 * the budget/timeout/parse reason — so a reader of the run card learns which
 * one happened without re-deriving it from prose.
 */
function buildValidateUpdate(
  result: ValidateOutcome,
): NonNullable<StepUpdate["validate"]> {
  const unjudged = result.status === "inconclusive";
  const inconclusiveError =
    unjudged && result.inconclusiveDetail !== undefined
      ? formatInconclusiveValidateError(result.inconclusiveDetail)
      : undefined;
  const error = result.invocationFailure ?? inconclusiveError;
  // The reason tag rides along with the prose so `bbx procedure resume` can
  // report the same non-verdict from the card alone.
  const reason = unjudged ? (result.inconclusiveReason ?? "unknown") : undefined;
  return {
    status: result.status,
    ...(result.stdout !== undefined && { stdout: result.stdout }),
    ...(result.review !== undefined && { review: result.review }),
    ...(error !== undefined && { error }),
    ...(reason !== undefined && { reason }),
  };
}

/**
 * The inconclusive record for a step that otherwise succeeded, or undefined.
 * A failed step reports its failure; the non-verdict only speaks when there
 * is nothing louder to say.
 */
function stepInconclusive(args: {
  stepId: string;
  failed: boolean;
  validateResult: ValidateOutcome | undefined;
}): ProcedureInconclusive | undefined {
  const { stepId, failed, validateResult } = args;
  if (failed || validateResult?.status !== "inconclusive") return undefined;
  return {
    stepId,
    reason: validateResult.inconclusiveReason ?? "unknown",
    detail: validateResult.inconclusiveDetail ?? "reached no verdict",
  };
}

/**
 * Build the final step update, persist it, commit, and report.
 */
async function recordStepResults(
  args: RecordStepResultsParams
): Promise<StepExecutionResult> {
  const {
    params,
    validateResult,
    reviewExhausted,
    runFailure,
    engineUnavailable,
    invocationFailure,
  } = args;
  const { ctx, boxRoot, step, procedure, runCardPath } = params;

  // A step fails when a run shell exited non-zero, when an `abort` validation
  // failed, when a `review` failure exhausted its retries (the auto-retry in
  // runAndValidate makes review gate), or when the engine was unavailable
  // (deferred-recoverable — the step can succeed on a later run), or when the
  // harness failed without a usable assistant response.
  //
  // An INCONCLUSIVE validation is not on that list, at any severity —
  // including `abort`. `abort` hard-gates a *failing check*; a check that
  // never decided has not failed, and treating its silence as a verdict is
  // the whole bug this state exists to fix. The run reports it separately.
  const validationGated =
    validateResult?.status === "fail" && step.validate?.severity === "abort";
  const failed =
    runFailure !== undefined ||
    validationGated ||
    reviewExhausted ||
    engineUnavailable !== undefined ||
    invocationFailure !== undefined;
  const stepUpdate: StepUpdate = {
    status: failed ? "failed" : "completed",
    completedAt: getBoxTimeISO(boxRoot),
  };

  if (step.precheck) {
    stepUpdate.precheck = { status: "pass", stdout: "" };
  }

  stepUpdate.run = buildRunUpdate(args);

  if (validateResult) {
    stepUpdate.validate = buildValidateUpdate(validateResult);
  }

  const succeeded = stepUpdate.status !== "failed";

  await updateStepInRunCard({ runCardPath, stepId: step.id, update: stepUpdate });
  await withBoxGitLock(boxRoot, async () => {
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `[procedure] ${succeeded ? "Complete" : "Failed"} step: ${step.id}`,
      trailers: { Procedure: procedure.name, Step: step.id },
    });
  });

  if (succeeded) {
    ctx.writeLine(fmt.ok(`Step completed: ${step.id}`));
  } else {
    ctx.writeLine(fmt.fail(`Step failed: ${step.id}`));
  }
  ctx.writeLine("");

  const inconclusive = stepInconclusive({
    stepId: step.id,
    failed,
    validateResult,
  });
  if (inconclusive !== undefined) {
    ctx.writeLine(
      fmt.warn(`  Review of ${step.id} ${inconclusive.detail} — the work is unjudged, not rejected.`)
    );
  }

  return {
    status: succeeded ? "completed" : "failed",
    ...(invocationFailure !== undefined && { error: `Agent invocation failed: ${invocationFailure}` }),
    ...(engineUnavailable !== undefined && { error: engineUnavailable }),
    ...(inconclusive !== undefined && { inconclusive }),
  };
}
