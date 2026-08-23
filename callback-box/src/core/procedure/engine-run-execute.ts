/** Execute a procedure run phase's agents and shell finalizers. */

import * as path from "node:path";
import { createAgent as realCreateAgent, type AgentInvokeOptions } from "../agent/index.js";
import { invariant } from "../../lib/invariant.js";
import { fmt } from "../../lib/format.js";
import { loadAgentEngine } from "../box/config.js";
import { resolveProcedureModel } from "../../shared/agent-models.js";
import type { ExecuteStepParams } from "./engine-step.js";
import {
  buildContextBlock,
  executePhaseShells,
  getStepLineRange,
} from "./engine-phase.js";

/** Hard cost ceiling (USD) per review-retry agent invocation. */
const REVIEW_RETRY_BUDGET_USD = 2;

/** A non-zero exit from a run-phase shell — gates the step like an abort. */
export interface RunShellFailure {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunPhaseParams = ExecuteStepParams & {
  precheckOutput?: string | undefined;
  retry?: { sessionId: string; failureContext: string };
};

export interface RunAgentOutcome {
  sessionId: string | undefined;
  engineUnavailable?: string;
  invocationFailure?: string;
}

function failedAgentOutcome(
  sessionId: string | undefined,
  result: Extract<Awaited<ReturnType<ReturnType<typeof realCreateAgent>["invoke"]>>, { success: false }>,
): RunAgentOutcome {
  if (result.unavailability !== undefined) {
    return { sessionId, engineUnavailable: result.error };
  }
  if (result.invocationFailure === true) {
    return { sessionId, invocationFailure: result.error };
  }
  return { sessionId };
}

async function retryRunAgent(params: RunPhaseParams): Promise<RunAgentOutcome> {
  const { ctx, boxRoot, step, procedure } = params;
  invariant(step.run, "retryRunAgent requires a run phase");
  invariant(params.retry, "retryRunAgent requires retry context");
  const [agentDef] = step.run.agents;
  invariant(agentDef !== undefined, "review retry requires exactly one run agent");
  const engine = await loadAgentEngine(boxRoot);
  const agentFactory = params.createAgent ?? realCreateAgent;
  ctx.writeLine(fmt.dim("  Re-running agent with validation feedback..."));
  const agent = agentFactory({
    name: `procedure-${procedure.name}-${step.id}`,
    sessionId: params.retry.sessionId,
    resume: true,
    onOutput: (text) => ctx.write(text),
  });
  const invokeOpts: AgentInvokeOptions = {
    boxRoot,
    prompt: params.retry.failureContext,
    maxTurns: agentDef.maxTurns ?? 20,
    maxBudgetUsd: REVIEW_RETRY_BUDGET_USD,
    ...(agentDef.model !== undefined && {
      model: resolveProcedureModel(engine, agentDef.model),
    }),
  };
  const result = await agent.invoke(invokeOpts);
  const sessionId = agent.sessionId ?? params.retry.sessionId;
  if (result.success) return { sessionId };
  ctx.writeLine(fmt.fail(`Agent failed: ${result.error}`));
  return failedAgentOutcome(sessionId, result);
}

/** Run all initial agents, stopping only on engine-level failure. */
export async function runRunAgents(params: RunPhaseParams): Promise<RunAgentOutcome> {
  if (params.retry !== undefined) return retryRunAgent(params);
  const {
    ctx,
    boxRoot,
    step,
    procedure,
    procedureCardPath,
    runCardPath,
    relProcedurePath,
  } = params;
  invariant(step.run, "runRunAgents requires a run phase");
  const agentFactory = params.createAgent ?? realCreateAgent;
  const engine = await loadAgentEngine(boxRoot);
  const relRunCardPath = path.relative(boxRoot, runCardPath);
  let sessionId: string | undefined;

  for (const agentDef of step.run.agents) {
    const modelId = agentDef.model === undefined
      ? undefined
      : resolveProcedureModel(engine, agentDef.model);
    ctx.writeLine(
      fmt.dim(`  Running agent${modelId === undefined ? "" : ` (${agentDef.model} → ${modelId})`}...`),
    );
    const stepLineRange = await getStepLineRange(procedureCardPath, step.id);
    const contextBlock = buildContextBlock({
      boxRoot,
      runCardPath: relRunCardPath,
      stepId: step.id,
      procedurePath: relProcedurePath,
      ...(stepLineRange !== undefined && { stepLineRange }),
      ...(params.precheckOutput !== undefined && { precheckOutput: params.precheckOutput }),
      ...(params.directive !== undefined && { directive: params.directive }),
    });
    const agent = agentFactory({
      name: `procedure-${procedure.name}-${step.id}`,
      onOutput: (text) => ctx.write(text),
    });
    const result = await agent.invoke({
      boxRoot,
      systemPrompt: `${contextBlock}\n\n${agentDef.prompt}`,
      prompt: `Execute the ${step.id} step of the ${procedure.name} procedure. Follow the instructions in your system prompt.`,
      maxTurns: agentDef.maxTurns ?? 20,
      ...(modelId !== undefined && { model: modelId }),
    });
    sessionId = agent.sessionId ?? undefined;
    if (!result.success) {
      ctx.writeLine(fmt.fail(`Agent failed: ${result.error}`));
      const failure = failedAgentOutcome(sessionId, result);
      if (failure.engineUnavailable !== undefined || failure.invocationFailure !== undefined) {
        return failure;
      }
    }
  }
  return { sessionId };
}

/** Run declared shells exactly once; they may be cleanup/finalizers. */
export async function runRunShells(
  params: ExecuteStepParams,
): Promise<{ runStdout: string | undefined; runFailure: RunShellFailure | undefined }> {
  const { ctx, boxRoot, step } = params;
  invariant(step.run, "runRunShells requires a run phase");
  if (step.run.shells.length === 0) {
    return { runStdout: undefined, runFailure: undefined };
  }
  ctx.writeLine(fmt.dim("  Running shell command..."));
  const result = await executePhaseShells(boxRoot, step.run);
  const runStdout = result.stdout || undefined;
  if (result.exitCode !== 0 && !result.skipped) {
    ctx.writeLine(fmt.fail(`Shell command failed (exit ${result.exitCode})`));
    if (result.stderr) ctx.writeLine(fmt.dim(`  ${result.stderr}`));
    return {
      runStdout,
      runFailure: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    };
  }
  if (result.stdout) ctx.writeLine(fmt.dim(`  ${result.stdout}`));
  return { runStdout, runFailure: undefined };
}
