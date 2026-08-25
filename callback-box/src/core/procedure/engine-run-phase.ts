/**
 * Run-phase execution + validation for a single procedure step.
 *
 * Split from engine-step.ts so the file stays under the line cap and the
 * review-retry orchestration lives in one place. The run phase's agents and
 * shells are executed separately ({@link runRunAgents} / {@link runRunShells})
 * so that a `severity: review` retry can re-invoke the agent without repeating
 * side-effecting shell commands.
 */

import { getHead } from "../../lib/git.js";
import { invariant } from "../../lib/invariant.js";
import { fmt } from "../../lib/format.js";
import type { ParsedStep } from "./engine-types.js";
import type { ExecuteStepParams } from "./engine-step.js";
import {
  executeValidation,
  ensureGitClean,
  type ValidationPhaseResult,
} from "./engine-phase.js";
import { runRunAgents, runRunShells, type RunShellFailure } from "./engine-run-execute.js";

/**
 * Max self-heal retries for a `severity: review` validation failure. Typed
 * `number` (not the narrowed literal `1`) since it's a tunable knob — the
 * plural-vs-singular check below stays meaningful if this value changes.
 */
const MAX_REVIEW_RETRIES: number = 1;

/**
 * The validation outcome shape carried between phases.
 *
 * `status: "inconclusive"` is a non-verdict — the judge never decided. It is
 * deliberately NOT "fail": the `severity: review` self-heal below keys on
 * `fail`, so an inconclusive check can never re-run the work agent. Redoing
 * finished work because the checker ran out of budget is the exact confusion
 * this state exists to end.
 */
export type ValidateOutcome = ValidationPhaseResult;

/** Result of running (and validating) a step's run phase. */
export interface RunAndValidateResult {
  gitRef: string;
  sessionId: string | undefined;
  runStdout: string | undefined;
  validateResult: ValidateOutcome | undefined;
  /** True when a `severity: review` failure couldn't be healed and must gate. */
  reviewExhausted: boolean;
  /** Set when a run-phase shell exited non-zero — the step fails objectively. */
  runFailure?: RunShellFailure;
  /** Set when a run agent failed deferred-recoverably (engine quota
   * exhausted): the informative message. The step fails immediately —
   * no shells, no validation, no review-retry into a dead engine. */
  engineUnavailable?: string;
  /** Harness rejection/failure without a usable assistant response. The
   * run shells still execute (some are intentional finalizers), then the step
   * gates before downstream validation can replace the root cause. */
  invocationFailure?: string;
}

/**
 * Build the resume prompt for a review-retry — the failure detail plus the
 * step's `whys:`, so the agent knows what to fix and why.
 */
function buildFailureContext(args: { step: ParsedStep; validateResult: ValidateOutcome }): string {
  const { step, validateResult } = args;
  const detail = validateResult.review || validateResult.stdout || "(no detail provided)";
  const whys = step.validate?.phase.whys ?? [];
  const whyBlock =
    whys.length > 0 ? `\n\nWhy this matters:\n${whys.map((w) => `- ${w}`).join("\n")}` : "";

  return `<validation-failure>
The validation for the ${step.id} step did not pass:

${detail}${whyBlock}
</validation-failure>

Address the failure above, redo the work so validation passes, and commit your changes.`;
}

/**
 * Run a step's run phase and validate it, with `severity: review` auto-retry.
 *
 * Attempt 0 runs the agents then the run shells once; subsequent attempts (only
 * for a failing `review` check on a single-agent run phase) re-invoke the agent
 * with the failure context and re-validate. Run shells never re-run.
 */
export async function runAndValidate(
  params: ExecuteStepParams & { precheckOutput: string | undefined }
): Promise<RunAndValidateResult> {
  const { ctx, boxRoot, step, procedure } = params;

  // Baseline ref before the run phase — start of the step's diff range, so
  // instruction validation judges the whole step (all commits), not just the last.
  const baseline = await getHead(boxRoot);

  const firstRun = await runRunAgents({ ...params });
  let { sessionId } = firstRun;
  if (firstRun.engineUnavailable !== undefined) {
    // Deferred-recoverable engine failure: fail the step immediately. Run
    // shells and validation would only produce a second, misleading error,
    // and a review-retry into a dead engine cannot succeed.
    const gitRefNow = await ensureGitClean({
      boxRoot,
      stepId: step.id,
      procedureName: procedure.name,
      ...(sessionId && { sessionId }),
    });
    return {
      gitRef: gitRefNow,
      sessionId,
      runStdout: undefined,
      validateResult: undefined,
      reviewExhausted: false,
      engineUnavailable: firstRun.engineUnavailable,
    };
  }
  const { runStdout, runFailure } = await runRunShells(params);
  let gitRef = await ensureGitClean({
    boxRoot,
    stepId: step.id,
    procedureName: procedure.name,
    ...(sessionId && { sessionId }),
  });

  // A run shell exited non-zero — the step failed objectively. Commit whatever
  // partial work happened (above) for provenance, then gate without validating.
  if (runFailure) {
    return {
      gitRef,
      sessionId,
      runStdout,
      validateResult: undefined,
      reviewExhausted: false,
      runFailure,
      ...(firstRun.invocationFailure !== undefined && {
        invocationFailure: firstRun.invocationFailure,
      }),
    };
  }

  if (firstRun.invocationFailure !== undefined) {
    return {
      gitRef,
      sessionId,
      runStdout,
      validateResult: undefined,
      reviewExhausted: false,
      invocationFailure: firstRun.invocationFailure,
    };
  }

  if (!step.validate) {
    return {
      gitRef,
      sessionId,
      runStdout,
      validateResult: undefined,
      reviewExhausted: false,
    };
  }

  const validate = (ref: string): Promise<ValidateOutcome> =>
    executeValidation({
      ctx,
      boxRoot,
      step,
      procedureName: procedure.name,
      baseline,
      gitRef: ref,
      ...(params.createAgent && { createAgent: params.createAgent }),
    });
  const rejectedValidation = (
    outcome: ValidateOutcome,
    error: string,
  ): RunAndValidateResult => ({
    gitRef, sessionId, runStdout, validateResult: outcome,
    reviewExhausted: false, invocationFailure: error,
  });

  ctx.writeLine(fmt.dim("  Validating..."));
  let validateResult = await validate(gitRef);
  if (validateResult.invocationFailure !== undefined) {
    return rejectedValidation(validateResult, validateResult.invocationFailure);
  }

  const severity = step.validate.severity;
  if (validateResult.status !== "fail" || severity !== "review") {
    return { gitRef, sessionId, runStdout, validateResult, reviewExhausted: false };
  }

  // severity: review — try to self-heal by re-invoking the run agent. Only a
  // single-agent run phase has one session to resume; anything else can't retry.
  // Reaching the review-retry path presupposes a run phase to resume.
  invariant(step.run, "review-severity retry reached without a run phase");
  if (step.run.agents.length !== 1 || sessionId === undefined) {
    ctx.writeLine(
      fmt.fail("  severity=review needs exactly one resumable run agent to retry — failing the step.")
    );
    return { gitRef, sessionId, runStdout, validateResult, reviewExhausted: true };
  }

  let attempt = 0;
  while (validateResult.status === "fail" && attempt < MAX_REVIEW_RETRIES) {
    attempt++;
    ctx.writeLine(fmt.warn(`  Validation failed (review) — retry ${attempt}/${MAX_REVIEW_RETRIES}`));
    const failureContext = buildFailureContext({ step, validateResult });
    const retried = await runRunAgents({ ...params, retry: { sessionId, failureContext } });
    if (retried.sessionId !== undefined) {
      sessionId = retried.sessionId;
    }
    if (retried.engineUnavailable !== undefined) {
      return {
        gitRef,
        sessionId,
        runStdout,
        validateResult,
        reviewExhausted: false,
        engineUnavailable: retried.engineUnavailable,
      };
    }
    gitRef = await ensureGitClean({
      boxRoot,
      stepId: step.id,
      procedureName: procedure.name,
      ...(sessionId && { sessionId }),
    });
    if (retried.invocationFailure !== undefined) {
      return {
        gitRef,
        sessionId,
        runStdout,
        validateResult,
        reviewExhausted: false,
        invocationFailure: retried.invocationFailure,
      };
    }
    validateResult = await validate(gitRef);
    if (validateResult.invocationFailure !== undefined) {
      return rejectedValidation(validateResult, validateResult.invocationFailure);
    }
  }

  const reviewExhausted = validateResult.status === "fail";
  if (reviewExhausted) {
    const plural = MAX_REVIEW_RETRIES === 1 ? "retry" : "retries";
    ctx.writeLine(
      fmt.fail(`  Validation still failing after ${MAX_REVIEW_RETRIES} ${plural} — failing the step.`)
    );
  }
  return { gitRef, sessionId, runStdout, validateResult, reviewExhausted };
}
