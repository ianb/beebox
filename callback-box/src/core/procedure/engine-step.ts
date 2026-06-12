/**
 * Single-step execution for the procedure engine: precheck, run (agents +
 * shells), validation, git-clean enforcement, and result recording.
 */

import * as path from "node:path";
import { createAgent as realCreateAgent, type AgentInvokeOptions } from "../agent.js";
import { stageAll, commit } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { runShell } from "./shell.js";
import type { CommandContext } from "../command-runner.js";
import {
  MODEL_MAP,
  type AgentFactory,
  type ParsedStep,
  type ParsedProcedure,
  type StepUpdate,
} from "./engine-types.js";
import { updateStepInRunCard } from "./engine-run-card.js";
import {
  executePhaseShells,
  executeValidation,
  ensureGitClean,
  buildContextBlock,
  getStepLineRange,
} from "./engine-phase.js";

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
  const { ctx, boxRoot, step, procedure, runCardPath } = params;

  ctx.writeLine(fmt.phase(`Step: ${step.id}`));
  ctx.writeLine(fmt.dim(step.description));
  ctx.writeLine("");

  // Update run card: step is now running (uncommitted signal)
  await updateStepInRunCard({
    runCardPath,
    stepId: step.id,
    update: {
      status: "running",
      startedAt: new Date().toISOString(),
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

  const runOutput = await runRunPhase({ ...params, precheckOutput: precheck.output });

  // Ensure git is clean after run phase
  const gitRef = await ensureGitClean({
    boxRoot,
    stepId: step.id,
    procedureName: procedure.name,
    ...(runOutput.sessionId && { sessionId: runOutput.sessionId }),
  });

  // ── Validate ──
  let validateResult: { status: string; stdout?: string; review?: string } | undefined;
  if (step.validate) {
    ctx.writeLine(fmt.dim("  Validating..."));
    validateResult = await executeValidation({ ctx, boxRoot, step });
  }

  // ── Record results ──
  return recordStepResults({
    params,
    gitRef,
    sessionId: runOutput.sessionId,
    runStdout: runOutput.runStdout,
    validateResult,
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
        completedAt: new Date().toISOString(),
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
      completedAt: new Date().toISOString(),
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
 * Execute the run phase's agents and shell commands.
 */
async function runRunPhase(
  params: ExecuteStepParams & { precheckOutput: string | undefined }
): Promise<{ sessionId: string | undefined; runStdout: string | undefined }> {
  const { ctx, boxRoot, step, procedure, procedureCardPath, runCardPath, relProcedurePath } =
    params;
  const relRunCardPath = path.relative(boxRoot, runCardPath);
  const run = step.run!;

  let sessionId: string | undefined;
  let runStdout: string | undefined;

  // Execute agents
  for (const agentDef of run.agents) {
    ctx.writeLine(fmt.dim(`  Running agent${agentDef.model ? ` (${agentDef.model})` : ""}...`));

    const stepLineRange = await getStepLineRange(procedureCardPath, step.id);
    const contextBlock = buildContextBlock({
      runCardPath: relRunCardPath,
      stepId: step.id,
      procedurePath: relProcedurePath,
      ...(stepLineRange && { stepLineRange }),
      ...(params.precheckOutput && { precheckOutput: params.precheckOutput }),
      ...(params.directive && { directive: params.directive }),
    });

    const systemPrompt = contextBlock + "\n\n" + agentDef.prompt;

    const agentFactory = params.createAgent ?? realCreateAgent;
    const agent = agentFactory({
      name: `procedure-${procedure.name}-${step.id}`,
      onOutput: (text) => ctx.write(text),
    });

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
      ctx.writeLine(fmt.fail(`Agent failed: ${agentResult.error ?? "unknown error"}`));
    }
  }

  // Execute shell commands in run phase
  for (const script of run.shells) {
    ctx.writeLine(fmt.dim("  Running shell command..."));
    const result = await runShell(boxRoot, script);
    runStdout = result.stdout;

    if (result.exitCode !== 0 && !result.skipped) {
      ctx.writeLine(fmt.fail(`Shell command failed (exit ${result.exitCode})`));
      if (result.stderr) {
        ctx.writeLine(fmt.dim(`  ${result.stderr}`));
      }
    } else if (result.stdout) {
      ctx.writeLine(fmt.dim(`  ${result.stdout}`));
    }
  }

  return { sessionId, runStdout };
}

/**
 * Parameters for recordStepResults
 */
interface RecordStepResultsParams {
  params: ExecuteStepParams;
  gitRef: string;
  sessionId: string | undefined;
  runStdout: string | undefined;
  validateResult: { status: string; stdout?: string; review?: string } | undefined;
}

/**
 * Build the final step update, persist it, commit, and report.
 */
async function recordStepResults(
  args: RecordStepResultsParams
): Promise<"completed" | "failed"> {
  const { params, gitRef, sessionId, runStdout, validateResult } = args;
  const { ctx, boxRoot, step, procedure, runCardPath } = params;

  const stepUpdate: StepUpdate = {
    status:
      validateResult?.status === "fail" && step.validate?.severity === "abort"
        ? "failed"
        : "completed",
    completedAt: new Date().toISOString(),
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

  await updateStepInRunCard({ runCardPath, stepId: step.id, update: stepUpdate });
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `[procedure] Complete step: ${step.id}`,
    trailers: { Procedure: procedure.name, Step: step.id },
  });

  const succeeded = stepUpdate.status !== "failed";
  if (succeeded) {
    ctx.writeLine(fmt.ok(`Step completed: ${step.id}`));
  } else {
    ctx.writeLine(fmt.fail(`Step failed: ${step.id}`));
  }
  ctx.writeLine("");

  return succeeded ? "completed" : "failed";
}
