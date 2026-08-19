/**
 * Run-phase execution + validation for a single procedure step.
 *
 * Split from engine-step.ts so the file stays under the line cap and the
 * review-retry orchestration lives in one place. The run phase's agents and
 * shells are executed separately ({@link runRunAgents} / {@link runRunShells})
 * so that a `severity: review` retry can re-invoke the agent without repeating
 * side-effecting shell commands.
 */

import * as path from "node:path";
import { createAgent as realCreateAgent, type AgentInvokeOptions } from "../agent/index.js";
import { getHead } from "../../lib/git.js";
import { invariant } from "../../lib/invariant.js";
import { fmt } from "../../lib/format.js";
import { MODEL_MAP, type ParsedStep, type ValidateStatus } from "./engine-types.js";
import type { ExecuteStepParams } from "./engine-step.js";
import {
  executePhaseShells,
  executeValidation,
  ensureGitClean,
  buildContextBlock,
  getStepLineRange,
} from "./engine-phase.js";

/**
 * Max self-heal retries for a `severity: review` validation failure. Typed
 * `number` (not the narrowed literal `1`) since it's a tunable knob — the
 * plural-vs-singular check below stays meaningful if this value changes.
 */
export const MAX_REVIEW_RETRIES: number = 1;

/** Hard cost ceiling (USD) per review-retry agent invocation — runaway guard. */
const REVIEW_RETRY_BUDGET_USD = 2;

/** The validation outcome shape carried between phases. */
export interface ValidateOutcome {
  status: ValidateStatus;
  stdout?: string;
  review?: string;
}

/** A non-zero exit from a run-phase shell — gates the step like an abort. */
export interface RunShellFailure {
  exitCode: number;
  stdout: string;
  stderr: string;
}

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
}

type RunPhaseParams = ExecuteStepParams & {
  precheckOutput?: string | undefined;
  /** Present on a review-retry: resume this session with the failure context. */
  retry?: { sessionId: string; failureContext: string };
};

/**
 * Execute the run phase's agents. On a retry (`params.retry`), resume the single
 * run agent's session with the validation-failure context instead of starting
 * fresh; review-retry is only reached for single-agent run phases.
 */
async function runRunAgents(
  params: RunPhaseParams,
): Promise<{ sessionId: string | undefined; engineUnavailable?: string }> {
  const { ctx, boxRoot, step, procedure, procedureCardPath, runCardPath, relProcedurePath } =
    params;
  invariant(step.run, "runRunAgents requires a run phase (checked by executeStep before invoking)");
  const { run } = step;
  const agentFactory = params.createAgent ?? realCreateAgent;
  const agentName = `procedure-${procedure.name}-${step.id}`;

  if (params.retry) {
    const [agentDef] = run.agents;
    invariant(
      agentDef !== undefined,
      "retry path only reached when run.agents.length === 1 (checked in runAndValidate)"
    );
    ctx.writeLine(fmt.dim("  Re-running agent with validation feedback..."));
    const agent = agentFactory({
      name: agentName,
      sessionId: params.retry.sessionId,
      resume: true,
      onOutput: (text) => ctx.write(text),
    });
    const invokeOpts: AgentInvokeOptions = {
      boxRoot,
      prompt: params.retry.failureContext,
      maxTurns: agentDef.maxTurns ?? 20,
      maxBudgetUsd: REVIEW_RETRY_BUDGET_USD,
    };
    if (agentDef.model) {
      invokeOpts.model = MODEL_MAP[agentDef.model] ?? agentDef.model;
    }
    const agentResult = await agent.invoke(invokeOpts);
    if (!agentResult.success) {
      ctx.writeLine(fmt.fail(`Agent failed: ${agentResult.error}`));
      if (agentResult.unavailability !== undefined) {
        return { sessionId: agent.sessionId ?? params.retry.sessionId, engineUnavailable: agentResult.error };
      }
    }
    return { sessionId: agent.sessionId ?? params.retry.sessionId };
  }

  const relRunCardPath = path.relative(boxRoot, runCardPath);
  let sessionId: string | undefined;

  for (const agentDef of run.agents) {
    ctx.writeLine(fmt.dim(`  Running agent${agentDef.model ? ` (${agentDef.model})` : ""}...`));

    const stepLineRange = await getStepLineRange(procedureCardPath, step.id);
    const contextBlock = buildContextBlock({
      boxRoot,
      runCardPath: relRunCardPath,
      stepId: step.id,
      procedurePath: relProcedurePath,
      ...(stepLineRange && { stepLineRange }),
      ...(params.precheckOutput && { precheckOutput: params.precheckOutput }),
      ...(params.directive && { directive: params.directive }),
    });

    const systemPrompt = contextBlock + "\n\n" + agentDef.prompt;

    const agent = agentFactory({ name: agentName, onOutput: (text) => ctx.write(text) });

    const invokeOpts: AgentInvokeOptions = {
      boxRoot,
      systemPrompt,
      prompt: `Execute the ${step.id} step of the ${procedure.name} procedure. Follow the instructions in your system prompt.`,
      maxTurns: agentDef.maxTurns ?? 20,
    };
    if (agentDef.model) {
      invokeOpts.model = MODEL_MAP[agentDef.model] ?? agentDef.model;
    }

    const agentResult = await agent.invoke(invokeOpts);
    sessionId = agent.sessionId ?? undefined;
    if (!agentResult.success) {
      ctx.writeLine(fmt.fail(`Agent failed: ${agentResult.error}`));
      if (agentResult.unavailability !== undefined) {
        // Deferred-recoverable: every further agent in this step would fail
        // the same way — stop here and let the step fail with the cause.
        return { sessionId, engineUnavailable: agentResult.error };
      }
    }
  }

  return { sessionId };
}

/**
 * Execute the run phase's shell commands. Run exactly once per step (never on a
 * review-retry). Shells run in order and short-circuit on the first non-zero
 * exit, which surfaces as a `runFailure` that fails the step (an exit of
 * `$CHECK_SKIP` is not a failure — the step's work simply opted out).
 */
async function runRunShells(
  params: ExecuteStepParams
): Promise<{ runStdout: string | undefined; runFailure: RunShellFailure | undefined }> {
  const { ctx, boxRoot, step } = params;
  invariant(step.run, "runRunShells requires a run phase (checked by executeStep before invoking)");
  const { run } = step;
  if (run.shells.length === 0) {
    return { runStdout: undefined, runFailure: undefined };
  }

  ctx.writeLine(fmt.dim("  Running shell command..."));
  const result = await executePhaseShells(boxRoot, run);
  const runStdout = result.stdout || undefined;

  if (result.exitCode !== 0 && !result.skipped) {
    ctx.writeLine(fmt.fail(`Shell command failed (exit ${result.exitCode})`));
    if (result.stderr) {
      ctx.writeLine(fmt.dim(`  ${result.stderr}`));
    }
    return {
      runStdout,
      runFailure: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    };
  }

  if (result.stdout) {
    ctx.writeLine(fmt.dim(`  ${result.stdout}`));
  }
  return { runStdout, runFailure: undefined };
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
    return { gitRef, sessionId, runStdout, validateResult: undefined, reviewExhausted: false, runFailure };
  }

  if (!step.validate) {
    return { gitRef, sessionId, runStdout, validateResult: undefined, reviewExhausted: false };
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

  ctx.writeLine(fmt.dim("  Validating..."));
  let validateResult = await validate(gitRef);

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
    validateResult = await validate(gitRef);
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
