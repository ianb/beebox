/**
 * Agent invocation - runs Claude via @anthropic-ai/claude-agent-sdk.
 *
 * The SDK still spawns a Claude Code subprocess (it bundles its own binary),
 * but we communicate via typed SDKMessage events instead of parsing raw stdout.
 *
 * Set CB_LOG_PROMPTS=1 to capture full API traffic (including system prompts
 * and CLAUDE.md content) via claude-code-logger. Logs go to .callback-box/logs/.
 */

import type { z } from "zod";
import { toJSONSchema } from "zod";
import { validateStructuredResult } from "./json.js";
import { appendSessionManifest } from "./manifest.js";
import { runAgent, type RunAgentOptions } from "./run.js";
import { createCodexAgent } from "./codex-agent.js";
import { loadAgentEngine } from "../box/config.js";
import type {
  AgentInvokeOptions,
  Agent,
  StructuredAgentResult,
  AgentResult,
} from "./types.js";

export type {
  AgentInvokeOptions,
  Agent,
  StructuredAgentResult,
  AgentResult,
  AgentResultBase,
} from "./types.js";

export {
  COMMIT_NUDGE_PROMPT,
  captureBaseline,
  ensureAgentCommitted,
  type EnsureCommittedOptions,
} from "./commit.js";

// ─── Agent interface ─────────────────────────────────────────────────

/**
 * Shared session-id callback used by both invoke variants: records the
 * SDK-assigned id and appends the session manifest entry exactly once.
 * The SDK-reported id is authoritative — it overwrites whatever the agent
 * was seeded with, so `agent.sessionId` only ever names a session that
 * actually exists on the SDK side (resume and commit-retry depend on that).
 */
function makeSessionIdHandler(state: {
  name: string;
  boxRoot: string;
  setSessionId(id: string): void;
  isManifestWritten(): boolean;
  markManifestWritten(): void;
}): (id: string) => void {
  return (id) => {
    state.setSessionId(id);
    if (!state.isManifestWritten()) {
      appendSessionManifest(state.boxRoot, {
        sessionId: id,
        task: state.name,
        timestamp: new Date().toISOString(),
      });
      state.markManifestWritten();
    }
  };
}

/**
 * Create a real agent that runs Claude via the SDK.
 *
 * If `sessionId` is given with `resume: true`, the first invoke resumes that
 * existing session. Without `resume`, the first invoke *creates* the session
 * with that id (the SDK's create-with-id mode), so a caller-minted id — e.g.
 * the chat reactor's per-thread session store — stays valid for later resumes.
 */
export function createClaudeAgent(options: {
  name: string;
  sessionId?: string;
  /** If true, first invoke() resumes the given sessionId. */
  resume?: boolean;
  onOutput?: (text: string) => void;
}): Agent {
  let sessionId: string | null = options.sessionId ?? null;
  let invocationCount = options.resume ? 1 : 0;
  let manifestWritten = false;

  const onSessionId = (boxRoot: string): ((id: string) => void) =>
    makeSessionIdHandler({
      name: options.name,
      boxRoot,
      setSessionId: (id) => {
        sessionId = id;
      },
      isManifestWritten: () => manifestWritten,
      markManifestWritten: () => {
        manifestWritten = true;
      },
    });

  const baseRunOptions = (opts: AgentInvokeOptions): RunAgentOptions => {
    const isResume = invocationCount > 0;
    invocationCount++;
    return {
      boxRoot: opts.boxRoot,
      systemPrompt: opts.systemPrompt ?? "",
      prompt: opts.prompt,
      onOutput: options.onOutput,
      model: opts.model,
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.maxBudgetUsd,
      dryRun: opts.dryRun,
      cwd: opts.cwd,
      additionalDirectories: opts.additionalDirectories,
      resumeSessionId: isResume && sessionId !== null ? sessionId : undefined,
      // Fresh session with a pre-minted id → create-with-id, so the id the
      // caller stored is the id the SDK actually creates.
      sessionId: !isResume && sessionId !== null ? sessionId : undefined,
      onSessionId: onSessionId(opts.boxRoot),
    };
  };

  return {
    name: options.name,
    get sessionId() {
      return sessionId;
    },
    async invoke(opts: AgentInvokeOptions): Promise<AgentResult> {
      return runAgent(baseRunOptions(opts));
    },
    async invokeStructured<T>(
      schema: z.ZodType<T>,
      opts: AgentInvokeOptions,
    ): Promise<StructuredAgentResult<T>> {
      const outputSchema: Record<string, unknown> = { ...toJSONSchema(schema) };
      // The CLI silently ignores `outputFormat` when the schema carries
      // zod's `$schema` meta-key — `structured_output` never arrives and
      // no error is reported. Strip it before handing the schema over.
      delete outputSchema["$schema"];
      const result = await runAgent({
        ...baseRunOptions(opts),
        outputSchema,
      });
      return validateStructuredResult(schema, result);
    },
  };
}

/**
 * Create an agent that selects the box's configured native harness on first
 * invocation. The selected delegate remains fixed for this Agent instance.
 */
export function createAgent(options: {
  name: string;
  sessionId?: string;
  resume?: boolean;
  onOutput?: (text: string) => void;
}): Agent {
  let delegate: Agent | null = null;
  let resolving: Promise<Agent> | null = null;

  const resolve = (boxRoot: string): Promise<Agent> => {
    if (delegate !== null) return Promise.resolve(delegate);
    resolving ??= loadAgentEngine(boxRoot).then((engine) => {
      delegate = engine === "codex"
        ? createCodexAgent(options)
        : createClaudeAgent(options);
      return delegate;
    });
    return resolving;
  };

  return {
    name: options.name,
    get sessionId() {
      return delegate?.sessionId ?? options.sessionId ?? null;
    },
    async invoke(invokeOptions: AgentInvokeOptions): Promise<AgentResult> {
      const agent = await resolve(invokeOptions.boxRoot);
      return agent.invoke(invokeOptions);
    },
    async invokeStructured<T>(
      schema: z.ZodType<T>,
      invokeOptions: AgentInvokeOptions,
    ): Promise<StructuredAgentResult<T>> {
      const agent = await resolve(invokeOptions.boxRoot);
      return agent.invokeStructured(schema, invokeOptions);
    },
  };
}
