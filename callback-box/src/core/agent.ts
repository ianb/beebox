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
import { fmt } from "../cli/lib/format.js";
import { getStatus, stageAll, commit, type GitStatus } from "../cli/lib/git.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import { buildScriptEnv } from "./script-env.js";

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
  /** Whether to run in dry-run mode (no side effects). */
  dryRun?: boolean;
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
        dryRun: opts.dryRun,
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

const __dirname = import.meta.dirname;
// callback-box repo root — used to locate the bundled card-validator plugin.
const CALLBACK_BOX_ROOT = path.resolve(__dirname, "../..");
const CARD_VALIDATOR_PLUGIN = path.join(CALLBACK_BOX_ROOT, "plugins", "card-validator");

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
  model?: string | undefined;
  /** Resume an existing session by id. */
  resumeSessionId?: string | undefined;
  /** Called once with the SDK-assigned session id (from the first system message). */
  onSessionId?: ((id: string) => void) | undefined;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  sessionId: string;
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

  try {
    const q = query({
      prompt,
      options: {
        cwd: boxRoot,
        env: dropUndefined(env),
        permissionMode: "bypassPermissions",
        maxTurns,
        ...(options.model !== undefined && { model: options.model }),
        ...(options.resumeSessionId !== undefined && { resume: options.resumeSessionId }),
        plugins: [{ type: "local", path: CARD_VALIDATOR_PLUGIN }],
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

/**
 * Build the system prompt for inbox processing.
 */
export function buildInboxProcessingPrompt(boxRoot: string): string {
  return `You are processing items in a Callback Box inbox.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Process news items (.news-item.card files) by:
1. Reading each item to understand the content
2. Creating a summary memo of interesting items
3. Marking items as processed

FOR NEWS ITEMS:
- Read the title, summary, and link from each card
- Identify the most interesting/notable items
- Create a summary memo at box/inbox/News_Summary_[DATE].memo.card
- Mark each processed item by changing status="new" to status="processed"

SUMMARY MEMO FORMAT:
\`\`\`xml
<memo status="new">
  <created>[ISO timestamp]</created>
  <content>
## News Summary for [Date]

### Top Stories
- [Title](link) - Brief note about why it's interesting

### Other Notable Items
- [Title](link)
- [Title](link)
  </content>
  <source>news-digest</source>
</memo>
\`\`\`

GUIDELINES:
- Use the Read tool to read card files
- Use the Edit tool to change status="new" to status="processed"
- Use the Write tool to create the summary memo
- Be concise - just note the key points
- Focus on what would be interesting/useful to know

When done, briefly state what you processed and summarized.`;
}

/**
 * Build a prompt for processing specific inbox items.
 */
export function buildItemProcessingPrompt(itemPaths: string[]): string {
  if (itemPaths.length === 0) {
    return "No items to process.";
  }

  const pathList = itemPaths.map((p) => `  - ${p}`).join("\n");

  return `Please process the following inbox items:

${pathList}

For each item:
1. Read and understand the content
2. Mark as processed (change status="new" to status="processed")
3. Note any items that need follow-up

When done, provide a brief summary of what you processed.`;
}
