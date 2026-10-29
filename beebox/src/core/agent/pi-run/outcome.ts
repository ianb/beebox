/**
 * How a pi run ended, and the run's limits.
 *
 * `agent_settled` is only where pi stops; the outcome is recorded here
 * (docs/plans/pi-box-engine.md, Track 4): `completed`, `interrupted` (the
 * caller's signal), `limit` (`maxTurns` or `maxBudgetUsd`), or `failed` (a
 * provider error on the last assistant message, or a thrown `prompt()`). It
 * maps to `AgentResult` as `codex-run/result.ts` does for Codex.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentResult, AgentResultBase } from "../types.js";
import type { PiAgentEvent } from "./validate.js";

export type PiOutcome =
  | { state: "completed" }
  | { state: "interrupted" }
  | { state: "limit" | "failed"; error: string };

export interface PiRunLimits {
  maxTurns: number;
  maxBudgetUsd?: number | undefined;
  onOutput?: ((text: string) => void) | undefined;
}

export interface PiRunWatch {
  /** pi's cost estimate for this invocation, from listed prices. */
  costUsd(): number;
  /** Whether the model produced text or tool calls, as opposed to failing at the first request. */
  hadActivity(): boolean;
  output(): string;
  /** True once the run was stopped or failed; no further prompt is sent. */
  stopped(): boolean;
  interrupt(): void;
  fail(error: string): void;
  outcome(): PiOutcome;
  dispose(): void;
}

function lastAssistant(session: AgentSession): AssistantMessage | undefined {
  return session.messages.findLast((message): message is AssistantMessage => message.role === "assistant");
}

function assistantText(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

/**
 * Reply text or a tool call (the remaining block type). Reasoning alone is
 * none: a run that only reasoned did no work, so its failure is a model
 * failure. pi ends a thrown run with one empty text block, also none.
 */
function substantive(message: AssistantMessage): boolean {
  return message.content.some((block) => {
    if (block.type === "text") return block.text.trim() !== "";
    return block.type !== "thinking";
  });
}

/**
 * Why a completed run with no structured result has no reply: its last
 * assistant message has reasoning and no text. `null` when it has text.
 */
export function noReplyError(session: AgentSession): string | null {
  if ((session.getLastAssistantText() ?? "").trim() !== "") return null;
  return `pi model ${session.model?.id ?? "(unknown)"} ended the run without reply text`;
}

/**
 * Watch one invocation: collect assistant text, count turns, sum the cost
 * estimate, and abort past a limit. Turns are counted at `turn_end` and
 * enforced at the next `turn_start`, so the last allowed turn finishes and
 * no request starts after it.
 */
export function watchPiRun(session: AgentSession, limits: PiRunLimits): PiRunWatch {
  let stopped: PiOutcome | null = null;
  let turns = 0;
  let cost = 0;
  let activity = false;
  let output = "";
  const stop = (outcome: PiOutcome): void => {
    if (stopped !== null) return;
    stopped = outcome;
    void session.abort();
  };
  const emit = (text: string): void => {
    output += text;
    limits.onOutput?.(text);
  };
  const onMessage = (message: AssistantMessage): void => {
    cost += message.usage.cost.total;
    activity ||= substantive(message);
    const text = assistantText(message);
    if (text !== "") emit(`${text}\n`);
    const budget = limits.maxBudgetUsd;
    if (budget !== undefined && cost > budget) {
      stop({ state: "limit", error: `pi run passed its budget: estimated $${cost.toFixed(4)} of $${budget.toFixed(4)}` });
    }
  };
  const unsubscribe = session.agent.subscribe((event: PiAgentEvent) => {
    if (event.type === "turn_start" && turns >= limits.maxTurns) {
      stop({ state: "limit", error: `pi run reached its turn limit (${String(limits.maxTurns)})` });
    } else if (event.type === "turn_end") {
      turns += 1;
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      onMessage(event.message);
    } else if (event.type === "tool_execution_start") {
      activity = true;
      emit(`[${event.toolName}]\n`);
    }
  });
  return {
    costUsd: () => cost,
    hadActivity: () => activity,
    output: () => output,
    stopped: () => stopped !== null,
    interrupt: () => stop({ state: "interrupted" }),
    fail: (error) => {
      stopped ??= { state: "failed", error };
    },
    outcome: () => {
      if (stopped !== null) return stopped;
      const last = lastAssistant(session);
      if (last?.stopReason === "error") return { state: "failed", error: last.errorMessage ?? "pi run failed" };
      if (last?.stopReason === "aborted") return { state: "interrupted" };
      return { state: "completed" };
    },
    dispose: unsubscribe,
  };
}

/** Map a pi run to the batch agent result, as `resultFromCodexTurn` does for Codex. */
export function resultFromPiRun(run: {
  outcome: PiOutcome;
  output: string;
  resultText: string;
  sessionId: string;
  structuredOutput?: unknown;
  hadActivity: boolean;
}): AgentResult {
  const { outcome } = run;
  const base: AgentResultBase = {
    output: run.output,
    resultText: run.resultText,
    exitCode: outcome.state === "completed" ? 0 : 1,
    sessionId: run.sessionId,
    structuredOutput: run.structuredOutput,
  };
  if (outcome.state === "completed") return { ...base, success: true };
  return {
    ...base,
    success: false,
    error: outcome.state === "interrupted" ? "pi run was interrupted" : outcome.error,
    // As for Codex: a failure before any assistant activity is a startup or model rejection.
    ...(outcome.state === "failed" && !run.hadActivity && { invocationFailure: true }),
  };
}
