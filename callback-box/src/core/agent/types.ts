/**
 * Public types for the agent invocation surface (`src/core/agent.ts`).
 *
 * Kept in a leaf module so the main agent file stays under the line cap.
 * `agent.ts` re-exports these, so consumers can keep importing them from
 * either location.
 */

import type { z } from "zod";
import type { EngineUnavailability } from "./engine-unavailability.js";

/**
 * Options passed to Agent.invoke() by the calling code.
 * The agent doesn't know these ahead of time — they're provided
 * by the command that uses the agent.
 */
export interface AgentInvokeOptions {
  boxRoot: string;
  /** System prompt — provided on first invoke, omitted on resume. */
  systemPrompt?: string;
  /** User prompt for this invocation. */
  prompt: string;
  /** Model override (e.g., "claude-haiku-4-5-20251001"). */
  model?: string;
  /** Maximum agent turns (default: 20). */
  maxTurns?: number;
  /**
   * Hard cost ceiling in USD. The SDK stops with `error_max_budget_usd`
   * if exceeded — surfaced here as `success: false` with a budget error.
   */
  maxBudgetUsd?: number;
  /** Whether to run in dry-run mode (no side effects). */
  dryRun?: boolean;
  /**
   * Override the SDK's working directory. Defaults to `boxRoot`. Set to a
   * subdirectory to reproduce a landmark-style session — the CLAUDE.md
   * walk-up at that path is auto-loaded into the agent's context. Pair
   * with `additionalDirectories: [boxRoot]` to keep the rest of the box
   * accessible.
   */
  cwd?: string;
  /**
   * Extra directories the agent can read/write beyond `cwd`. Forwarded to
   * the SDK's `additionalDirectories` option.
   */
  additionalDirectories?: string[];
}

/**
 * Transport fields present on every agent result, success or failure. These
 * describe the run itself (its output, exit code, and session) independent of
 * whether it succeeded, so they're common to both arms of {@link AgentResult}
 * rather than split across them.
 */
export interface AgentResultBase {
  output: string;
  exitCode: number;
  sessionId: string;
  /** Populated when the underlying run was started with `outputSchema`. */
  structuredOutput?: unknown;
  /**
   * The SDK's final-turn assistant text (the `result` field of the
   * `SDKResultSuccess`). Cleaner than `output`, which carries our rendered
   * tool-call summaries and ANSI codes.
   */
  resultText?: string;
}

/**
 * The outcome of an agent run. A discriminated union on `success`: the
 * transport fields are shared, and only the failure arm carries `error` —
 * making "a failure always has an error message, a success never claims one" a
 * type-level guarantee rather than the doc-comment convention it used to be.
 */
export type AgentResult =
  | (AgentResultBase & { success: true })
  | (AgentResultBase & {
      success: false;
      error: string;
      /**
       * Present when the native harness failed without a usable assistant
       * response (for example auth/model rejection or an SDK transport
       * failure). This is different from a started turn ending at its
       * turn/budget limit: callers
       * may preserve partial-work behavior for the latter, but must surface and
       * gate an invocation failure.
       */
      invocationFailure?: true;
      /**
       * Present when the failure is deferred-recoverable: the engine is
       * unavailable (e.g. quota-exhausted) and will work again at `retryAt`.
       * Callers branch on this to defer instead of retrying or counting the
       * failure against the task. Absent = ordinary failure.
       */
      unavailability?: EngineUnavailability;
    });

/**
 * Result of `Agent.invokeStructured`. The transport fields plus the parsed
 * `data`, split so `success ⇔ data present`: on success `data` is the validated
 * `T`; on failure `data` is `null` and `error` carries the cause (no result,
 * schema mismatch, or agent error). The old `data: T | null` doc contract is
 * now the type.
 */
export type StructuredAgentResult<T> =
  | (AgentResultBase & { success: true; data: T })
  | (AgentResultBase & {
      success: false;
      error: string;
      data: null;
      invocationFailure?: true;
    });

/**
 * A named agent with session lifecycle.
 *
 * First invoke() starts a new session; the SDK assigns a session id which
 * becomes available via `sessionId` once the first system message arrives.
 * Subsequent invoke() calls resume the same session.
 *
 * `sessionId` is `null` before the first invoke completes — the SDK assigns
 * it server-side, we don't generate it ourselves. All known consumers read
 * it only after `await agent.invoke(...)`, at which point it's set.
 */
export interface Agent {
  readonly name: string;
  readonly sessionId: string | null;
  invoke(options: AgentInvokeOptions): Promise<AgentResult>;
  /**
   * Structured-output variant: the agent returns JSON matching `schema`
   * instead of free-form text. The SDK passes the schema to the model,
   * waits for the structured turn, and surfaces the result via
   * `result.structured_output`. We validate it against the same Zod
   * schema and return both the parsed `data` and the regular result
   * fields.
   *
   * Use when the agent's job is "produce a decision/object", not
   * "do work and commit".
   */
  invokeStructured<T>(
    schema: z.ZodType<T>,
    options: AgentInvokeOptions,
  ): Promise<StructuredAgentResult<T>>;
}
