/**
 * SDK runner internals for the agent.
 *
 * `runAgent` drives a single agent turn (or session-resume turn) through
 * `@anthropic-ai/claude-agent-sdk`: it sets up the optional prompt-logger
 * proxy and env, builds the SDK query options, consumes the message stream,
 * and translates the outcome into the public `AgentResult` shape.
 */

import { fmt } from "../../lib/format.js";
import { buildTimezoneContext } from "../box/config.js";
import { buildScriptEnv } from "../script-env.js";
import { cardValidatorHook, gitMvNudgeHook } from "../sdk-hooks.js";
import { resolveClaudeCodeBinary } from "../sdk-binary-path.js";
import { startPromptLogger, type PromptLogger } from "./prompt-logger.js";
import { consumeAgentStream, type RunStreamOutcome } from "./stream.js";
import { checkClaudeAuth, ClaudeAuthError } from "./auth-preflight.js";
import { dropUndefined } from "../../lib/drop-undefined.js";
import { normalizeModelId } from "../../shared/model-ids.js";
import type { AgentResult, AgentResultBase } from "./types.js";

export interface RunAgentOptions {
  boxRoot: string;
  systemPrompt: string;
  prompt: string;
  onOutput?: ((text: string) => void) | undefined;
  dryRun?: boolean | undefined;
  maxTurns?: number | undefined;
  maxBudgetUsd?: number | undefined;
  model?: string | undefined;
  /** Resume an existing session by id. */
  resumeSessionId?: string | undefined;
  /**
   * Create the session with this specific id (the SDK's create-with-id
   * `sessionId` option; must be a valid UUID). Lets callers pre-mint an id
   * (e.g. the chat reactor's per-thread session store) that stays valid for
   * later `resumeSessionId` runs. Ignored when resuming.
   */
  sessionId?: string | undefined;
  /** Called once with the SDK-assigned session id (from the first system message). */
  onSessionId?: ((id: string) => void) | undefined;
  /**
   * If set, the SDK is told to produce structured JSON matching this schema
   * and `result.structuredOutput` carries the parsed value. The caller is
   * responsible for validating against its own schema.
   */
  outputSchema?: Record<string, unknown> | undefined;
  /** SDK working directory. Defaults to `boxRoot` when omitted. */
  cwd?: string | undefined;
  /** Forwarded to the SDK's `additionalDirectories` option. */
  additionalDirectories?: string[] | undefined;
}

interface RunContext {
  env: Record<string, string>;
  maxTurns: number;
  binaryPath: string | null;
  appendedSystem: string;
}

/**
 * Build the `options` object handed to the SDK's `query()` for a run.
 */
function buildQueryOptions(
  options: RunAgentOptions,
  context: RunContext,
): Record<string, unknown> {
  const { env, maxTurns, binaryPath, appendedSystem } = context;
  return {
    cwd: options.cwd ?? options.boxRoot,
    env,
    permissionMode: "bypassPermissions",
    maxTurns,
    ...(binaryPath !== null && { pathToClaudeCodeExecutable: binaryPath }),
    ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
    ...(options.model !== undefined && { model: normalizeModelId(options.model) }),
    ...(options.resumeSessionId !== undefined && { resume: options.resumeSessionId }),
    // Create-with-id: only valid on a fresh session (the SDK rejects
    // `sessionId` combined with `resume` unless forking).
    ...(options.resumeSessionId === undefined &&
      options.sessionId !== undefined && { sessionId: options.sessionId }),
    ...(options.outputSchema !== undefined && {
      outputFormat: { type: "json_schema" as const, schema: options.outputSchema },
    }),
    ...(options.additionalDirectories && options.additionalDirectories.length > 0 && {
      additionalDirectories: options.additionalDirectories,
    }),
    hooks: { PreToolUse: [gitMvNudgeHook()], PostToolUse: [cardValidatorHook()] },
    // settingSources defaults to ["user", "project"] which auto-loads
    // CLAUDE.md, .claude/settings.json, .claude/rules/, etc.
    ...(appendedSystem !== "" && {
      systemPrompt: {
        type: "preset" as const,
        preset: "claude_code" as const,
        append: appendedSystem,
      },
    }),
  };
}

/**
 * Translate the raw stream outcome into the public `AgentResult` shape,
 * including error/success classification and structured-output passthrough.
 */
function buildAgentResult(outcome: RunStreamOutcome, resumeSessionId: string | undefined): AgentResult {
  const { outputBuf, resultMessage, assignedSessionId, errorText } = outcome;
  const sessionId = assignedSessionId ?? resumeSessionId ?? "";

  if (errorText !== null) {
    return { success: false, output: outputBuf, error: errorText, exitCode: -1, sessionId };
  }
  if (resultMessage === null) {
    return {
      success: false,
      output: outputBuf,
      error: "Agent ended without a result message",
      exitCode: -1,
      sessionId,
    };
  }

  const isError = resultMessage.is_error || resultMessage.subtype !== "success";
  const base: AgentResultBase = {
    output: outputBuf,
    exitCode: isError ? 1 : 0,
    sessionId,
  };
  if (resultMessage.subtype === "success") {
    if ("structured_output" in resultMessage) {
      base.structuredOutput = resultMessage.structured_output;
    }
    base.resultText = resultMessage.result;
  }
  if (!isError) {
    return { ...base, success: true };
  }
  let error: string;
  if (resultMessage.subtype !== "success") {
    const errs = "errors" in resultMessage ? resultMessage.errors : [];
    error = errs.length > 0 ? errs.join("\n") : resultMessage.subtype;
  } else {
    error = "result.is_error was true";
  }
  return { ...base, success: false, error };
}

/**
 * Emit the pre-run banner (command line, system prompt, user prompt) via
 * `onOutput`.
 */
function emitRunBanner(
  options: RunAgentOptions,
  context: { isResume: boolean; maxTurns: number; systemPrompt: string; tzContext: string },
): void {
  const { onOutput } = options;
  const { isResume, maxTurns, systemPrompt, tzContext } = context;
  onOutput?.(
    fmt.dim("$ ") +
      fmt.cmd("claude-agent-sdk query") +
      fmt.dim(
        ` (model=${options.model ?? "default"} maxTurns=${maxTurns}${isResume ? ` resume=${options.resumeSessionId}` : ""})`,
      ) +
      "\n",
  );
  if (!isResume && (systemPrompt || tzContext)) {
    onOutput?.(`\n${fmt.dim("System prompt:")}\n${fmt.dim("─".repeat(40))}\n${systemPrompt}${tzContext}\n${fmt.dim("─".repeat(40))}\n\n`);
  }
  onOutput?.(`${fmt.dim("User prompt:")}\n${fmt.dim("─".repeat(40))}\n${options.prompt}\n${fmt.dim("─".repeat(40))}\n\n`);
}

/**
 * Start the optional prompt-logger proxy and build the SDK env. Returns the
 * logger (or null) and the prepared env record.
 */
async function setupRunEnv(
  options: RunAgentOptions,
  filenameHint: string,
): Promise<{ logger: PromptLogger | null; env: Record<string, string> }> {
  const { boxRoot, onOutput } = options;
  const shouldLog = process.env.CB_LOG_PROMPTS === "1";
  const logger = shouldLog ? await startPromptLogger(boxRoot, filenameHint) : null;

  if (shouldLog && logger) {
    onOutput?.(`Prompt logging enabled → .callback-box/logs/${filenameHint}.log\n`);
  } else if (shouldLog) {
    onOutput?.("Warning: prompt logging requested but logger failed to start\n");
  }

  // Build env. CLAUDECODE is unset so the SDK can run nested inside Claude Code.
  // ANTHROPIC_API_KEY is already stripped by buildScriptEnv to force subscription auth.
  const env = await buildScriptEnv(boxRoot, {
    CLAUDECODE: undefined,
    ...(logger ? { ANTHROPIC_BASE_URL: `http://localhost:${logger.port}/` } : {}),
  });

  return { logger, env: dropUndefined(env) };
}

/**
 * Run a single agent turn (or session-resume turn) via the SDK.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const { boxRoot, systemPrompt, prompt, dryRun = false, maxTurns = 20 } = options;

  const isResume = options.resumeSessionId !== undefined;
  const tzContext = isResume ? "" : await buildTimezoneContext(boxRoot);

  if (dryRun) {
    return {
      success: true,
      output: `[DRY RUN] Would run Claude via SDK with prompt:\n${prompt}`,
      exitCode: 0,
      sessionId: options.resumeSessionId ?? options.sessionId ?? "",
    };
  }

  // Preflight: a missing/expired Claude login otherwise surfaces as an opaque
  // SDK `success: false` — fail fast with an actionable message instead. The
  // check caches a positive result, so per-turn calls here don't re-shell.
  // Fakes replace `createAgent`, so this real SDK path (and its probe) is never
  // reached by fake-injecting tests.
  try {
    await checkClaudeAuth();
  } catch (e) {
    if (e instanceof ClaudeAuthError) {
      return {
        success: false,
        output: "",
        error: e.message,
        exitCode: -1,
        sessionId: options.resumeSessionId ?? options.sessionId ?? "",
      };
    }
    throw e;
  }

  const filenameHint = `${new Date().toISOString().replace(/[.:]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const { logger, env } = await setupRunEnv(options, filenameHint);

  emitRunBanner(options, { isResume, maxTurns, systemPrompt, tzContext });

  const appendedSystem = isResume ? "" : systemPrompt + tzContext;
  const binaryPath = resolveClaudeCodeBinary();

  const queryOptions = buildQueryOptions(options, {
    env,
    maxTurns,
    binaryPath,
    appendedSystem,
  });
  const outcome = await consumeAgentStream({
    prompt: options.prompt,
    queryOptions,
    onOutput: options.onOutput,
    onSessionId: options.onSessionId,
    logger,
  });

  return buildAgentResult(outcome, options.resumeSessionId);
}
