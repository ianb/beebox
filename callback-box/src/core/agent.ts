/**
 * Agent invocation - runs Claude via @anthropic-ai/claude-agent-sdk.
 *
 * The SDK still spawns a Claude Code subprocess (it bundles its own binary),
 * but we communicate via typed SDKMessage events instead of parsing raw stdout.
 *
 * Set CB_LOG_PROMPTS=1 to capture full API traffic (including system prompts
 * and CLAUDE.md content) via claude-code-logger. Logs go to .callback-box/logs/.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createWriteStream, appendFileSync, type WriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import {
  query,
  type SDKMessage,
  type SDKAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { toJSONSchema } from "zod";
import { fmt } from "../cli/lib/format.js";
import { getStatus, stageAll, commit, type GitStatus } from "../cli/lib/git.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import { buildScriptEnv } from "./script-env.js";
import { cardValidatorHook } from "./sdk-hooks.js";
import { resolveClaudeCodeBinary } from "./sdk-binary-path.js";

// ─── Agent interface ─────────────────────────────────────────────────

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

/**
 * Result of `Agent.invokeStructured`. Same fields as `AgentResult` plus
 * the parsed `data`. On structured-output failure (no result, schema
 * mismatch, agent error) `success` is false, `data` is null, and `error`
 * carries the cause.
 */
export interface StructuredAgentResult<T> extends AgentResult {
  data: T | null;
}

/**
 * Create a real agent that runs Claude via the SDK.
 *
 * If `sessionId` is given (typically with `resume: true`), the first invoke
 * resumes that existing session.
 */
export function createAgent(options: {
  name: string;
  sessionId?: string;
  /** If true, first invoke() resumes the given sessionId. */
  resume?: boolean;
  onOutput?: (text: string) => void;
}): Agent {
  let sessionId: string | null = options.sessionId ?? null;
  let invocationCount = options.resume ? 1 : 0;
  let manifestWritten = false;

  return {
    name: options.name,
    get sessionId() {
      return sessionId;
    },
    async invoke(opts: AgentInvokeOptions): Promise<AgentResult> {
      const isResume = invocationCount > 0;
      invocationCount++;

      const result = await runAgent({
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
        onSessionId: (id) => {
          if (sessionId === null) sessionId = id;
          if (!manifestWritten) {
            appendSessionManifest(opts.boxRoot, {
              sessionId: id,
              task: options.name,
              timestamp: new Date().toISOString(),
            });
            manifestWritten = true;
          }
        },
      });

      return result;
    },
    async invokeStructured<T>(
      schema: z.ZodType<T>,
      opts: AgentInvokeOptions,
    ): Promise<StructuredAgentResult<T>> {
      const isResume = invocationCount > 0;
      invocationCount++;

      const result = await runAgent({
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
        outputSchema: toJSONSchema(schema) as Record<string, unknown>,
        onSessionId: (id) => {
          if (sessionId === null) sessionId = id;
          if (!manifestWritten) {
            appendSessionManifest(opts.boxRoot, {
              sessionId: id,
              task: options.name,
              timestamp: new Date().toISOString(),
            });
            manifestWritten = true;
          }
        },
      });

      if (!result.success) {
        return { ...result, data: null };
      }
      // Prefer the SDK-provided structured_output. Fall back to parsing
      // JSON out of the model's final assistant text — some model/CLI
      // versions return JSON in the turn instead of populating
      // structured_output.
      const candidate =
        result.structuredOutput ??
        (result.resultText !== undefined ? extractJsonFromText(result.resultText) : undefined);
      if (candidate === undefined) {
        return {
          ...result,
          success: false,
          data: null,
          error: "Structured output: no JSON found in result",
        };
      }
      const parsed = schema.safeParse(candidate);
      if (!parsed.success) {
        return {
          ...result,
          success: false,
          data: null,
          error: `Structured output failed schema validation: ${parsed.error.message}`,
        };
      }
      return { ...result, data: parsed.data };
    },
  };
}

export const COMMIT_NUDGE_PROMPT = `IMPORTANT: You have uncommitted changes in the working directory. Please:

1. Review the current state of your work (git status, check files)
2. Commit everything with a descriptive message following the format in your original instructions

Do NOT leave changes uncommitted. Commit now.`;

export interface EnsureCommittedOptions {
  boxRoot: string;
  /** Agent to resume for commit retry. */
  agent: Agent;
  /** Fallback commit message if retry also fails */
  fallbackMessage: string;
  /** Trailers for fallback commit */
  fallbackTrailers: Record<string, string>;
  /** Callback for status messages */
  onOutput?: (text: string) => void;
  /** Baseline git status from before the agent ran — used to distinguish
   *  pre-existing untracked files from agent-created ones. */
  baseline?: GitStatus;
}

/**
 * Check whether a git status has changes beyond what existed before the agent ran.
 * Staged and modified files are always considered agent changes.
 * Untracked files are only considered if they weren't already untracked before.
 */
function hasNewChanges(status: GitStatus, baseline: GitStatus): boolean {
  if (status.staged.length > 0 || status.modified.length > 0) return true;
  const baselineSet = new Set(baseline.untracked);
  return status.untracked.some((f) => !baselineSet.has(f));
}

/**
 * Capture a baseline snapshot of git status before the agent runs.
 * Pass the result to `ensureAgentCommitted` so it can distinguish
 * pre-existing untracked files from agent-created ones.
 */
export async function captureBaseline(boxRoot: string): Promise<GitStatus> {
  return getStatus(boxRoot);
}

/**
 * Ensure the agent committed its work. If uncommitted changes remain,
 * resume the same session with a nudge to commit. If that also fails,
 * create a fallback commit marked with Fallback: true.
 */
export async function ensureAgentCommitted(options: EnsureCommittedOptions): Promise<void> {
  const { boxRoot, agent, fallbackMessage, fallbackTrailers, onOutput } = options;
  const baseline = options.baseline ?? { staged: [], modified: [], untracked: [], clean: true };

  const status = await getStatus(boxRoot);
  if (!hasNewChanges(status, baseline)) return;

  // Retry: resume the same session with a nudge to commit
  onOutput?.(fmt.dim("  (Agent didn't commit — resuming session to request commit...)\n"));
  await agent.invoke({
    boxRoot,
    prompt: COMMIT_NUDGE_PROMPT,
    maxTurns: 5,
  });

  const retryStatus = await getStatus(boxRoot);
  if (!hasNewChanges(retryStatus, baseline)) {
    onOutput?.(fmt.ok("  Agent committed on retry\n"));
    return;
  }

  // Final fallback: commit with Fallback trailer
  onOutput?.(fmt.warn("  Agent failed to commit after retry — creating fallback commit\n"));
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: fallbackMessage,
    trailers: { ...fallbackTrailers, Fallback: "true" },
  });
}

// ─── Session manifest ─────────────────────────────────────────────────

const MANIFEST_REL_PATH = "store/usage/session-manifest.jsonl";

interface ManifestEntry {
  sessionId: string;
  task: string;
  timestamp: string;
}

function appendSessionManifest(boxRoot: string, entry: ManifestEntry): void {
  const manifestPath = path.join(boxRoot, MANIFEST_REL_PATH);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  appendFileSync(manifestPath, JSON.stringify(entry) + "\n");
}

// ─── SDK plumbing ─────────────────────────────────────────────────────

/**
 * Render a single SDKMessage event to a human-readable line for `onOutput`.
 * Loose imitation of the CLI's verbose stream — assistant text passes
 * through verbatim, tool calls and results get one-line summaries.
 */
function renderSdkMessage(msg: SDKMessage): string {
  if (msg.type === "system" && msg.subtype === "init") {
    const sid = msg.session_id;
    return fmt.dim(`[session ${sid.slice(0, 8)} model=${msg.model ?? "default"}]\n`);
  }
  if (msg.type === "assistant") {
    return renderAssistantMessage(msg);
  }
  if (msg.type === "user") {
    // Tool results — one-line summary per block.
    const lines: string[] = [];
    const content = msg.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const text = extractToolResultText(block.content);
          const summary = text ? truncate(text.replace(/\s+/g, " "), 200) : "(no content)";
          const errMark = block.is_error ? fmt.fail(" [error]") : "";
          lines.push(fmt.dim(`  ↳ ${summary}${errMark}\n`));
        }
      }
    }
    return lines.join("");
  }
  if (msg.type === "result") {
    if (msg.subtype === "success") {
      return fmt.ok(
        `\n[done in ${msg.num_turns} turn(s), ${(msg.duration_ms / 1000).toFixed(1)}s]\n`,
      );
    }
    return fmt.fail(`\n[result error: ${msg.subtype}]\n`);
  }
  return "";
}

function renderAssistantMessage(msg: SDKAssistantMessage): string {
  const lines: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === "text") {
      if (block.text) lines.push(block.text);
    } else if (block.type === "tool_use") {
      const inputSummary = summarizeToolInput(block.input);
      lines.push(fmt.dim(`\n→ ${block.name}(${inputSummary})\n`));
    } else if (block.type === "thinking") {
      // Thinking blocks: keep noise low — single line marker.
      lines.push(fmt.dim("  …thinking…\n"));
    }
  }
  if (msg.error) {
    lines.push(fmt.fail(`\n[assistant error: ${msg.error}]\n`));
  }
  return lines.join("");
}

function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  // Surface common fields concisely.
  for (const key of ["command", "file_path", "path", "pattern", "url"]) {
    const v = obj[key];
    if (typeof v === "string") return truncate(v, 120);
  }
  return truncate(JSON.stringify(obj), 120);
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object" && "type" in item && item.type === "text") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Start a claude-code-logger proxy for capturing full API traffic.
 * Returns the proxy process, port, and log file stream.
 *
 * Session id is captured from the first SDK system message, so this is
 * given a placeholder filename until then — but in practice we start the
 * logger before invoking the SDK, so we use a timestamp-based filename.
 */
async function startPromptLogger(
  boxRoot: string,
  filenameHint: string,
): Promise<{ proxy: ChildProcess; port: number; logStream: WriteStream } | null> {
  const logsDir = path.join(boxRoot, ".callback-box", "logs");
  await fs.mkdir(logsDir, { recursive: true });

  const logPath = path.join(logsDir, `${filenameHint}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });

  const header = `\n${"=".repeat(60)}\nLog: ${filenameHint}\nStarted: ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`;
  logStream.write(header);

  const port = 30000 + Math.floor(Math.random() * 20000);

  const proxy = spawn("npx", [
    "claude-code-logger", "start",
    "--port", String(port),
    "--verbose",
    "--log-body",
    "--merge-sse",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proxy.stdout?.on("data", (data) => logStream.write(data));
  proxy.stderr?.on("data", (data) => logStream.write(data));

  const ready = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes("Proxy server started")) {
        clearTimeout(timeout);
        resolve(true);
      }
    };
    proxy.stdout?.on("data", onData);
    proxy.stderr?.on("data", onData);
    proxy.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    proxy.on("close", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });

  if (!ready) {
    proxy.kill();
    logStream.write("Failed to start prompt logger proxy\n");
    logStream.end();
    return null;
  }

  return { proxy, port, logStream };
}

function stopPromptLogger(logger: { proxy: ChildProcess; logStream: WriteStream }): void {
  logger.proxy.kill();
  const footer = `\n${"=".repeat(60)}\nEnded: ${new Date().toISOString()}\n${"=".repeat(60)}\n`;
  logger.logStream.write(footer);
  logger.logStream.end();
}

interface RunAgentOptions {
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

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
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
 * Best-effort: pull a JSON value out of the assistant's free-form result
 * text. Fallback for when the SDK didn't populate `structured_output`.
 * Tries fenced ```json blocks first, then a bare object/array span.
 * Returns undefined if nothing parses.
 */
function extractJsonFromText(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\S\s]*?)\n```/i.exec(text);
  if (fence !== null && fence[1] !== undefined) {
    try {
      return JSON.parse(fence[1]);
    } catch (_e) {
      // fall through to bare-span scan
    }
  }
  const start = text.search(/[[{]/);
  if (start === -1) return undefined;
  // Walk from `start` to the matching close, respecting strings.
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_e) {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Drop env entries with undefined values to satisfy Record<string, string>.
 */
function dropUndefined(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Run a single agent turn (or session-resume turn) via the SDK.
 */
async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    boxRoot,
    systemPrompt,
    prompt,
    onOutput,
    dryRun = false,
    maxTurns = 20,
  } = options;

  const isResume = options.resumeSessionId !== undefined;
  const tzContext = isResume ? "" : await buildTimezoneContext(boxRoot);

  if (dryRun) {
    return {
      success: true,
      output: `[DRY RUN] Would run Claude via SDK with prompt:\n${prompt}`,
      exitCode: 0,
      sessionId: options.resumeSessionId ?? "",
    };
  }

  // Prompt-logger proxy (optional).
  const shouldLog = process.env.CB_LOG_PROMPTS === "1";
  const filenameHint = `${new Date().toISOString().replace(/[.:]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
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

  // Banner showing what's running.
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
  onOutput?.(`${fmt.dim("User prompt:")}\n${fmt.dim("─".repeat(40))}\n${prompt}\n${fmt.dim("─".repeat(40))}\n\n`);

  const appendedSystem = isResume ? "" : systemPrompt + tzContext;

  let outputBuf = "";
  let resultMessage: SDKMessage | null = null;
  let assignedSessionId: string | null = null;
  let errorText: string | null = null;

  const binaryPath = resolveClaudeCodeBinary();

  try {
    const q = query({
      prompt,
      options: {
        cwd: options.cwd ?? boxRoot,
        env: dropUndefined(env),
        permissionMode: "bypassPermissions",
        maxTurns,
        ...(binaryPath !== null && { pathToClaudeCodeExecutable: binaryPath }),
        ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
        ...(options.model !== undefined && { model: options.model }),
        ...(options.resumeSessionId !== undefined && { resume: options.resumeSessionId }),
        ...(options.outputSchema !== undefined && {
          outputFormat: { type: "json_schema" as const, schema: options.outputSchema },
        }),
        ...(options.additionalDirectories && options.additionalDirectories.length > 0 && {
          additionalDirectories: options.additionalDirectories,
        }),
        hooks: { PostToolUse: [cardValidatorHook()] },
        // settingSources defaults to ["user", "project"] which auto-loads
        // CLAUDE.md, .claude/settings.json, .claude/rules/, etc.
        ...(appendedSystem !== "" && {
          systemPrompt: {
            type: "preset" as const,
            preset: "claude_code" as const,
            append: appendedSystem,
          },
        }),
      },
    });

    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        if (assignedSessionId === null) {
          assignedSessionId = msg.session_id;
          options.onSessionId?.(msg.session_id);
        }
      }
      if (msg.type === "result") {
        resultMessage = msg;
      }
      const rendered = renderSdkMessage(msg);
      if (rendered) {
        outputBuf += rendered;
        onOutput?.(rendered);
      }
    }
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
  } finally {
    if (logger) stopPromptLogger(logger);
  }

  const sessionId = assignedSessionId ?? options.resumeSessionId ?? "";

  if (errorText !== null) {
    return {
      success: false,
      output: outputBuf,
      error: errorText,
      exitCode: -1,
      sessionId,
    };
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
  const result: AgentResult = {
    success: !isError,
    output: outputBuf,
    exitCode: isError ? 1 : 0,
    sessionId,
  };
  if (resultMessage.subtype === "success") {
    if ("structured_output" in resultMessage) {
      result.structuredOutput = resultMessage.structured_output;
    }
    result.resultText = resultMessage.result;
  }
  if (isError) {
    if (resultMessage.subtype !== "success") {
      const errs = "errors" in resultMessage ? resultMessage.errors : [];
      result.error = errs.length > 0 ? errs.join("\n") : resultMessage.subtype;
    } else {
      result.error = "result.is_error was true";
    }
  }
  return result;
}

