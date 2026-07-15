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
  AgentResultBase,
  StructuredAgentResult,
} from "../../src/core/agent/index.js";

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

/**
 * The flat partial a scripted `act` returns — the fields it may set, with the
 * fake filling in defaults. Kept flat (not `Partial<AgentResult>`, which is now
 * a discriminated union) so a script can set any subset without committing to
 * an arm; the fake assembles the real union from it.
 */
interface FakeActOutcome {
  success?: boolean;
  output?: string;
  exitCode?: number;
  error?: string;
  structuredOutput?: unknown;
  resultText?: string;
}

export interface FakeAgentOptions {
  name: string;
  /**
   * Pre-minted session id (mirrors `createAgent`). Without `resume`, the
   * fake "creates" its session with this id; with `resume`, it's the
   * session to resume.
   */
  sessionId?: string;
  /**
   * If true, the first invoke() resumes `sessionId` — and, like the real
   * SDK, fails with "No conversation found" unless that id is present in
   * `knownSessions`.
   */
  resume?: boolean;
  /**
   * Registry of session ids "created" by earlier fake agents. Share one
   * Set across a `createAgent` factory to model cross-cycle session
   * resume: fresh sessions register their id here on first invoke, and a
   * `resume: true` agent whose id is missing fails like the real SDK.
   */
  knownSessions?: Set<string>;
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
  }) => Promise<FakeActOutcome>;
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
  const sessionId =
    options.sessionId !== undefined ? options.sessionId : `fake-${randomUUID().slice(0, 8)}`;
  const invocations: FakeAgentInvocation[] = [];

  return {
    name: options.name,
    sessionId,
    invocations,

    async invoke(opts: AgentInvokeOptions): Promise<AgentResult> {
      const invocationIndex = invocations.length;
      const resumed = options.resume === true || invocationIndex > 0;

      if (invocationIndex === 0) {
        if (options.resume === true) {
          // Real-SDK semantics: resuming a session id that was never
          // created fails before the agent does any work.
          const known = options.knownSessions !== undefined && options.knownSessions.has(sessionId);
          if (!known) {
            const result: AgentResult = {
              success: false,
              output: "",
              exitCode: 1,
              error: `No conversation found with session ID: ${sessionId}`,
              sessionId,
            };
            invocations.push({ systemPrompt: null, prompt: opts.prompt, resumed, options: opts, result });
            return result;
          }
        } else {
          // Fresh session — register its id as created (create-with-id
          // when the caller pre-minted one, auto-generated otherwise).
          options.knownSessions?.add(sessionId);
        }
      }

      const partial = await options.act({
        boxRoot: opts.boxRoot,
        prompt: opts.prompt,
        invocation: invocationIndex,
      });

      const base: AgentResultBase = {
        output: partial.output !== undefined ? partial.output : "",
        exitCode: partial.exitCode !== undefined ? partial.exitCode : partial.success === false ? 1 : 0,
        sessionId,
        ...(partial.structuredOutput !== undefined && { structuredOutput: partial.structuredOutput }),
        ...(partial.resultText !== undefined && { resultText: partial.resultText }),
      };
      const result: AgentResult =
        partial.success === false
          ? { ...base, success: false, error: partial.error !== undefined ? partial.error : "fake agent failure" }
          : { ...base, success: true };

      invocations.push({
        systemPrompt: resumed ? null : opts.systemPrompt !== undefined ? opts.systemPrompt : null,
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
        systemPrompt: opts.systemPrompt !== undefined ? opts.systemPrompt : null,
        prompt: opts.prompt,
        invocation: invocationIndex,
      });

      // null models a failed/unparseable verdict; otherwise validate against
      // the caller's schema exactly as the real invokeStructured does.
      const parsed = raw === null ? null : schema.safeParse(raw);
      const data = parsed === null ? null : parsed.success ? parsed.data : null;
      const structuredBase: AgentResultBase = { output: "", exitCode: data !== null ? 0 : 1, sessionId };

      const result: StructuredAgentResult<T> =
        data !== null
          ? { ...structuredBase, success: true, data }
          : {
              ...structuredBase,
              success: false,
              data: null,
              error:
                raw === null
                  ? "fake structured failure"
                  : parsed !== null && !parsed.success
                    ? parsed.error.message
                    : "fake structured failure",
            };

      invocations.push({
        systemPrompt: resumed ? null : opts.systemPrompt !== undefined ? opts.systemPrompt : null,
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
          lines.push("<system-prompt>");
          lines.push(inv.systemPrompt);
          lines.push("</system-prompt>");
        }

        const attrs = inv.resumed ? " continued=\"true\"" : "";
        const status = inv.result.success
          ? `success (exit ${inv.result.exitCode})`
          : `failed (exit ${inv.result.exitCode}${inv.result.error ? `: ${inv.result.error}` : ""})`;
        lines.push(`<invoke${attrs}>`);
        lines.push(inv.prompt);
        lines.push(`  → ${status}`);
        lines.push("</invoke>");
      }

      lines.push("</agent>");
      return lines.join("\n");
    },
  };
}
