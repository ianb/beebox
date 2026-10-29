/** pi implementation of the batch Agent contract (docs/plans/pi-box-engine.md, Track 4). */

import type { z } from "zod";
import { validateStructuredResult } from "../json.js";
import { appendSessionManifest } from "../manifest.js";
import { createCarrier } from "../model-carry.js";
import { runPiAgent } from "../pi-run/run.js";
import type { Agent, AgentInvokeOptions, AgentResult, StructuredAgentResult } from "../types.js";
import { buildAgentTimeContext } from "./simulated-clock.js";

export interface CreatePiAgentOptions {
  name: string;
  /** With `resume`, the pi session the first invoke reopens. */
  sessionId?: string;
  resume?: boolean;
  onOutput?: (text: string) => void;
}

/** pi's runtime seams; tests pass pi's `faux` provider here. */
type PiSessionDeps = Parameters<typeof runPiAgent>[1];

/** Create a batch agent backed by an in-process pi session. */
export function createPiAgent(options: CreatePiAgentOptions, deps?: PiSessionDeps): Agent {
  let sessionId: string | null = options.resume === true ? options.sessionId ?? null : null;
  // pi finds a session by id only under the cwd it was created in.
  let sessionCwd: string | undefined;
  let manifestWritten = false;
  // See model-carry.ts: a resumed run keeps its model and system prompt.
  const modelCarrier = createCarrier();
  const systemPromptCarrier = createCarrier();

  const run = async (invoke: AgentInvokeOptions, resultSchema?: z.ZodType): Promise<AgentResult> => {
    const resuming = sessionId !== null;
    // Sent on resume too, as on Claude: the time is the run's, not the session's.
    const timeContext = await buildAgentTimeContext(invoke.boxRoot);
    return runPiAgent({
      boxRoot: invoke.boxRoot,
      env: invoke.env,
      signal: invoke.signal,
      systemPrompt: (systemPromptCarrier.resolve(invoke.systemPrompt) ?? "") + timeContext,
      prompt: invoke.prompt,
      onOutput: options.onOutput,
      model: modelCarrier.resolve(invoke.model),
      maxTurns: invoke.maxTurns,
      maxBudgetUsd: invoke.maxBudgetUsd,
      dryRun: invoke.dryRun,
      cwd: resuming ? sessionCwd ?? invoke.cwd : invoke.cwd,
      loadBoxContext: invoke.loadBoxContext,
      tools: invoke.tools,
      resumeSessionId: sessionId ?? undefined,
      resultSchema,
      onSessionId: (assigned) => {
        if (!resuming) sessionCwd = invoke.cwd ?? invoke.boxRoot;
        sessionId = assigned;
        if (manifestWritten) return;
        appendSessionManifest(invoke.boxRoot, { sessionId: assigned, task: options.name, timestamp: new Date().toISOString() });
        manifestWritten = true;
      },
    }, deps);
  };

  return {
    name: options.name,
    get sessionId() {
      return sessionId;
    },
    invoke: (invoke) => run(invoke),
    async invokeStructured<T>(schema: z.ZodType<T>, invoke: AgentInvokeOptions): Promise<StructuredAgentResult<T>> {
      return validateStructuredResult(schema, await run(invoke, schema));
    },
  };
}
