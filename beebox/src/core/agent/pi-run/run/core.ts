/**
 * Drive one batch-agent invocation through a pi session
 * (docs/implemented-plans/pi-box-engine.md, Track 4).
 *
 * OpenRouter failures, 402 and 429 included, are ordinary failures carrying
 * OpenRouter's message. Nothing goes to the engine availability store: it
 * assumes one machine-wide account per engine, and an OpenRouter key is
 * granted per box.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { z } from "zod";
import { errorMessage } from "../../../../shared/error-guards.js";
import { invariant } from "../../../../shared/invariant.js";
import { loadAddedModels, loadBoxModel } from "../../../box/config.js";
import { resolveBoxModelForEngine } from "../../../model-policy.js";
import { piModelMissing } from "../../../provider-env/openrouter-chat.js";
import type { AgentResult } from "../../types.js";
import { noReplyError, resultFromPiRun, watchPiRun, type PiOutcome, type PiRunWatch } from "../outcome.js";
import { piResultTool, RESULT_TOOL_FOLLOW_UP, type PiResultTool } from "./result-tool.js";
import { openPiSession, type PiSessionDeps } from "../session/core.js";
import { watchPiValidation } from "../validate.js";

export interface PiRunOptions {
  signal?: AbortSignal | undefined;
  boxRoot: string;
  env?: Record<string, string> | undefined;
  /** The full appended prompt, the box time context included. */
  systemPrompt: string;
  prompt: string;
  onOutput?: ((text: string) => void) | undefined;
  /** Omitted runs the box's pinned default, which must be an added model. */
  model?: string | undefined;
  maxTurns?: number | undefined;
  maxBudgetUsd?: number | undefined;
  dryRun?: boolean | undefined;
  /** For a resume, the directory the session was created in: pi finds a session by id only under its cwd. */
  cwd?: string | undefined;
  loadBoxContext?: boolean | undefined;
  tools?: string[] | undefined;
  resumeSessionId?: string | undefined;
  /** The id for a new session, as `AgentInvokeOptions` callers supply it; defaults to a fresh UUID. */
  newSessionId?: string | undefined;
  onSessionId?: ((id: string) => void) | undefined;
  /** For a structured invocation: the `submit_result` arguments, checked against it by pi, are the run's `structuredOutput`. */
  resultSchema?: z.ZodType | undefined;
}

/** pi has no default model: the box's pin, when it is an added model, or a refusal. */
async function runModel(options: PiRunOptions): Promise<string> {
  if (options.model !== undefined) return options.model;
  const model = resolveBoxModelForEngine("pi", {
    pinned: await loadBoxModel(options.boxRoot),
    added: await loadAddedModels(options.boxRoot),
  });
  if (model === null) throw piModelMissing();
  return model;
}

async function openForRun(options: PiRunOptions & { resultTool: PiResultTool | undefined }, deps: PiSessionDeps | undefined) {
  const opened = await openPiSession({
    boxRoot: options.boxRoot,
    model: await runModel(options),
    purpose: "agent-run",
    systemPrompt: options.systemPrompt,
    env: options.env,
    tools: options.tools,
    loadBoxContext: options.loadBoxContext,
    cwd: options.cwd,
    resumeSessionId: options.resumeSessionId,
    newSessionId: options.newSessionId,
    customTools: options.resultTool === undefined ? undefined : [options.resultTool.tool],
    requireKnownPrices: options.maxBudgetUsd !== undefined,
  }, deps);
  invariant(opened.kind === "session", "a pi run that is not a dry run opens a session");
  return opened;
}

async function promptOnce(session: AgentSession, { watch, text }: { watch: PiRunWatch; text: string }): Promise<void> {
  if (watch.stopped()) return;
  try {
    await session.prompt(text);
  } catch (error) {
    watch.fail(errorMessage(error));
  }
}

/**
 * The run's outcome after the settle-time checks: a validation finding that
 * still stands, no structured result, or, for a run without one, no reply text.
 */
function settledOutcome(outcome: PiOutcome, checks: { invalid: boolean; missingResult: boolean; noReply: string | null }): PiOutcome {
  if (outcome.state !== "completed") return outcome;
  if (checks.invalid) return { state: "failed", error: "pi edits failed Bee Box validation" };
  if (checks.missingResult) return { state: "failed", error: "model did not return a structured result" };
  if (checks.noReply !== null) return { state: "failed", error: checks.noReply };
  return outcome;
}

async function drive(session: AgentSession, options: PiRunOptions & { resultTool: PiResultTool | undefined }): Promise<AgentResult> {
  const watch = watchPiRun(session, {
    maxTurns: options.maxTurns ?? 20,
    maxBudgetUsd: options.maxBudgetUsd,
    onOutput: options.onOutput,
  });
  const validation = watchPiValidation(session, options.cwd ?? options.boxRoot);
  const onAbort = (): void => watch.interrupt();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted === true) onAbort();
  try {
    await promptOnce(session, { watch, text: options.prompt });
    const { resultTool } = options;
    // One follow-up, and only after a run that completed without the call.
    if (resultTool !== undefined && resultTool.submitted() === undefined && watch.outcome().state === "completed") {
      await promptOnce(session, { watch, text: RESULT_TOOL_FOLLOW_UP });
    }
    const validated = await validation.settle();
    const notes = [
      validated.feedback === null ? "" : `Bee Box validation ${validated.hasErrors ? "failed" : "warning"}:\n${validated.feedback}\n`,
      `pi estimated cost: $${watch.costUsd().toFixed(4)}\n`,
    ].join("");
    options.onOutput?.(notes);
    return resultFromPiRun({
      outcome: settledOutcome(watch.outcome(), {
        invalid: validated.hasErrors,
        missingResult: resultTool !== undefined && resultTool.submitted() === undefined,
        noReply: resultTool === undefined ? noReplyError(session) : null,
      }),
      output: watch.output() + notes,
      resultText: session.getLastAssistantText() ?? "",
      sessionId: session.sessionId,
      structuredOutput: resultTool?.submitted(),
      hadActivity: watch.hadActivity(),
    });
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    validation.dispose();
    watch.dispose();
  }
}

/** Run one fresh or resumed pi invocation and map it to the batch agent result. */
export async function runPiAgent(options: PiRunOptions, deps?: PiSessionDeps): Promise<AgentResult> {
  options.signal?.throwIfAborted();
  const sessionId = options.resumeSessionId ?? "";
  if (options.dryRun === true) {
    return { success: true, output: `[DRY RUN] Would run pi with prompt:\n${options.prompt}`, exitCode: 0, sessionId };
  }
  const run = { ...options, resultTool: options.resultSchema === undefined ? undefined : piResultTool(options.resultSchema) };
  let opened: Awaited<ReturnType<typeof openForRun>>;
  try {
    opened = await openForRun(run, deps);
  } catch (error) {
    // No model was called: a setup refusal (no model, no key, unpriced model
    // under a budget, unknown session) or a failure to start pi.
    return { success: false, output: "", error: errorMessage(error), exitCode: -1, sessionId, invocationFailure: true };
  }
  options.onSessionId?.(opened.sessionId);
  try {
    return await drive(opened.session, run);
  } finally {
    opened.session.dispose();
  }
}
