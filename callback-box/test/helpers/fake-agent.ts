/**
 * Fake agent for testing commands that invoke Claude Code.
 *
 * Records every invocation (system prompt, user prompt, result) and
 * runs a user-supplied `act` function to simulate the agent's work.
 *
 * Usage:
 *   const agent = createFakeAgent({
 *     name: "triage",
 *     act: async ({ boxRoot }) => {
 *       // simulate agent work: move files, edit cards, commit
 *       execSync("git add -A && git commit -m 'done'", { cwd: boxRoot });
 *       return { success: true };
 *     },
 *   });
 *
 *   const result = await executeTriageFeedback(ctx, { agent });
 *   print(agent.printLog());
 */

import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type {
  Agent,
  AgentInvokeOptions,
  AgentResult,
  StructuredAgentResult,
} from "../../src/core/agent.js";

export interface FakeAgentInvocation {
  /** System prompt — present on first invoke, null on resume. */
  systemPrompt: string | null;
  /** User prompt for this invocation. */
  prompt: string;
  /** Whether this was a resumed session. */
  resumed: boolean;
  /** Full invoke options for detailed assertions (model, maxTurns, etc.). */
  options: AgentInvokeOptions;
  /** Result returned by the act function. */
  result: AgentResult;
}

/** Thrown when invokeStructured is called on a fake created without `structuredResult`. */
export class FakeAgentStructuredUnsupportedError extends Error {
  constructor() {
    super(
      "FakeAgent.invokeStructured needs createFakeAgent({ structuredResult }) — pass a scripted verdict provider for structured-output tests.",
    );
    this.name = "FakeAgentStructuredUnsupportedError";
  }
}

export interface FakeAgent extends Agent {
  /** All recorded invocations in order. */
  invocations: FakeAgentInvocation[];
  /**
   * Render a structured log of all invocations.
   * System prompt shown on first invocation only.
   * Useful for doctest assertions.
   */
  printLog(): string;
}

export interface FakeAgentOptions {
  name: string;
  /**
   * Called when invoke() is hit. Performs the "agent's work" —
   * file moves, edits, commits, etc. Returns partial AgentResult
   * (defaults filled in for success/exitCode/output/sessionId).
   *
   * `invocation` is 0-indexed — use it to script multi-turn behavior
   * (e.g., first call forgets to commit, second call commits).
   */
  act: (ctx: {
    boxRoot: string;
    prompt: string;
    invocation: number;
  }) => Promise<Partial<AgentResult>>;
  /**
   * Called when invokeStructured() is hit — returns the scripted verdict
   * `data` (validated against the caller's schema). Return `null` to simulate
   * a model failure / unparseable output (StructuredAgentResult.data === null).
   * `invocation` is shared with `act` (0-indexed across all invokes).
   */
  structuredResult?: (ctx: {
    boxRoot: string;
    systemPrompt: string | null;
    prompt: string;
    invocation: number;
  }) => unknown;
}

export function createFakeAgent(options: FakeAgentOptions): FakeAgent {
  const sessionId = `fake-${randomUUID().slice(0, 8)}`;
  const invocations: FakeAgentInvocation[] = [];

  return {
    name: options.name,
    sessionId,
    invocations,

    async invoke(opts: AgentInvokeOptions): Promise<AgentResult> {
      const invocationIndex = invocations.length;
      const resumed = invocationIndex > 0;

      const partial = await options.act({
        boxRoot: opts.boxRoot,
        prompt: opts.prompt,
        invocation: invocationIndex,
      });

      const result: AgentResult = {
        success: partial.success ?? true,
        output: partial.output ?? "",
        exitCode: partial.exitCode ?? (partial.success === false ? 1 : 0),
        sessionId,
        ...(partial.error && { error: partial.error }),
      };

      invocations.push({
        systemPrompt: resumed ? null : (opts.systemPrompt ?? null),
        prompt: opts.prompt,
        resumed,
        options: opts,
        result,
      });

      return result;
    },

    async invokeStructured<T>(
      schema: z.ZodType<T>,
      opts: AgentInvokeOptions,
    ): Promise<StructuredAgentResult<T>> {
      if (!options.structuredResult) {
        throw new FakeAgentStructuredUnsupportedError();
      }
      const invocationIndex = invocations.length;
      const resumed = invocationIndex > 0;

      const raw = await options.structuredResult({
        boxRoot: opts.boxRoot,
        systemPrompt: opts.systemPrompt ?? null,
        prompt: opts.prompt,
        invocation: invocationIndex,
      });

      // null models a failed/unparseable verdict; otherwise validate against
      // the caller's schema exactly as the real invokeStructured does.
      const parsed = raw === null ? null : schema.safeParse(raw);
      const data: T | null = parsed === null ? null : parsed.success ? parsed.data : null;
      const success = data !== null;

      const result: StructuredAgentResult<T> = {
        success,
        output: "",
        exitCode: success ? 0 : 1,
        sessionId,
        data,
        ...(parsed !== null && !parsed.success && { error: parsed.error.message }),
        ...(raw === null && { error: "fake structured failure" }),
      };

      invocations.push({
        systemPrompt: resumed ? null : (opts.systemPrompt ?? null),
        prompt: opts.prompt,
        resumed,
        options: opts,
        result,
      });

      return result;
    },

    printLog(): string {
      const lines: string[] = [];
      lines.push(`<agent name="${options.name}" session="${sessionId}">`);

      for (const inv of invocations) {
        if (inv.systemPrompt != null) {
          lines.push(`<system-prompt>`);
          lines.push(inv.systemPrompt);
          lines.push(`</system-prompt>`);
        }

        const attrs = inv.resumed ? ` continued="true"` : "";
        const status = inv.result.success
          ? `success (exit ${inv.result.exitCode})`
          : `failed (exit ${inv.result.exitCode}${inv.result.error ? `: ${inv.result.error}` : ""})`;
        lines.push(`<invoke${attrs}>`);
        lines.push(inv.prompt);
        lines.push(`  → ${status}`);
        lines.push(`</invoke>`);
      }

      lines.push(`</agent>`);
      return lines.join("\n");
    },
  };
}
