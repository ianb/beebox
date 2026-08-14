/** Codex implementation of the existing batch Agent contract. */

import type { z } from "zod";
import { toJSONSchema } from "zod";
import { appendSessionManifest } from "./manifest.js";
import { validateStructuredResult } from "./json.js";
import { runCodexAgent, type CodexRunOptions } from "./codex-run.js";
import type {
  Agent,
  AgentInvokeOptions,
  AgentResult,
  StructuredAgentResult,
} from "./types.js";

export interface CreateCodexAgentOptions {
  name: string;
  sessionId?: string;
  resume?: boolean;
  onOutput?: (text: string) => void;
}

/** Create a batch agent backed by the installed Codex app-server. */
export function createCodexAgent(options: CreateCodexAgentOptions): Agent {
  let sessionId: string | null = options.resume === true
    ? options.sessionId ?? null
    : null;
  let invocationCount = options.resume === true ? 1 : 0;
  let manifestWritten = false;

  const runOptions = (invoke: AgentInvokeOptions): CodexRunOptions => {
    const isResume = invocationCount > 0;
    invocationCount += 1;
    return {
      boxRoot: invoke.boxRoot,
      systemPrompt: invoke.systemPrompt ?? "",
      prompt: invoke.prompt,
      onOutput: options.onOutput,
      model: invoke.model,
      maxTurns: invoke.maxTurns,
      maxBudgetUsd: invoke.maxBudgetUsd,
      dryRun: invoke.dryRun,
      cwd: invoke.cwd,
      additionalDirectories: invoke.additionalDirectories,
      resumeSessionId: isResume && sessionId !== null ? sessionId : undefined,
      onSessionId: (assigned) => {
        sessionId = assigned;
        if (manifestWritten) return;
        appendSessionManifest(invoke.boxRoot, {
          sessionId: assigned,
          task: options.name,
          timestamp: new Date().toISOString(),
        });
        manifestWritten = true;
      },
    };
  };

  return {
    name: options.name,
    get sessionId() {
      return sessionId;
    },
    invoke(invoke: AgentInvokeOptions): Promise<AgentResult> {
      return runCodexAgent(runOptions(invoke));
    },
    async invokeStructured<T>(
      schema: z.ZodType<T>,
      invoke: AgentInvokeOptions,
    ): Promise<StructuredAgentResult<T>> {
      const outputSchema: Record<string, unknown> = { ...toJSONSchema(schema) };
      delete outputSchema["$schema"];
      const result = await runCodexAgent({
        ...runOptions(invoke),
        outputSchema,
      });
      return validateStructuredResult(schema, result);
    },
  };
}
