/**
 * ChatSession - Manages a long-lived Claude process for interactive chat.
 *
 * Follows the Thinking Machine pattern: spawns claude CLI with
 * --output-format stream-json --input-format stream-json, keeps the
 * process alive between messages, and resumes sessions across restarts.
 */

import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  getSessionLogPath,
  parseSessionLog,
  tailForMinUserMessages,
  type SessionEntry,
} from "../cli/lib/session.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import { generateDocs } from "./generate-docs.js";
import { buildScriptEnv } from "./script-env.js";
import type { MCPServerConfig } from "../activities/index.js";
import {
  createClaudeChatSpawner,
  type ClaudeChatProcess,
  type ClaudeChatSpawner,
} from "../services/claude-chat.js";

// Path to the cb-claude wrapper binary — used to extend PATH for subprocess tools.
const __dirname = import.meta.dirname;
const binDir = path.resolve(__dirname, "../../bin");

/**
 * Compute the tail size honoring both an explicit tail and a minimum number
 * of real user messages to include. Returns null to mean "no trimming".
 */
function effectiveTailSize(
  entries: SessionEntry[],
  params?: { tail?: number; minRealUserMessages?: number },
): number | null {
  const tail = params ? params.tail : undefined;
  const minUsers = params ? params.minRealUserMessages : undefined;
  const userTail = minUsers && minUsers > 0
    ? tailForMinUserMessages(entries, minUsers)
    : 0;
  if (tail !== undefined && tail > 0) {
    return Math.max(tail, userTail);
  }
  if (userTail > 0) return userTail;
  return null;
}

/**
 * Content block in a Claude stream-json message.
 */
export interface ChatMessageContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** For image blocks */
  source?: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

/**
 * A message from the Claude stream-json protocol.
 */
export interface ChatMessage {
  type:
    | "system"
    | "assistant"
    | "user"
    | "stream_event"
    | "result"
    | "rate_limit_event";
  subtype?: string;
  session_id?: string;
  uuid?: string;
  message?: {
    role: string;
    content: ChatMessageContent[];
    stop_reason?: string | null;
  };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

const DEFAULT_SESSION_FILE = ".callback-box/chat-session-id.json";
const DEFAULT_MODEL_FILE = ".callback-box/chat-model.json";

/**
 * Configurable knobs for a ChatSession. All fields are optional — the
 * defaults match the pre-existing "main chat" behavior.
 *
 * Activity sessions pass overrides for `systemPrompt` (base + mode prompt),
 * `mcpConfig` (tools), `sessionFile` (per-instance pointer), `extraEnv`
 * (CB_ACTIVITY_*), and `onSessionIdAssigned` (per-session bookkeeping).
 */
export interface ChatSessionOptions {
  /** Resolves the system prompt at process-start. Default: CHAT_SYSTEM_PROMPT + tzContext. */
  systemPrompt?: (boxRoot: string) => Promise<string>;
  /** MCP server config. When set, written to a temp JSON file and passed via --mcp-config. */
  mcpConfig?: MCPServerConfig | null;
  /**
   * Path to the current-session-id pointer, relative to boxRoot.
   * Default: .callback-box/chat-session-id.json. Set to `null` to opt out of
   * filesystem persistence — used by the registry, which manages session
   * bookkeeping out-of-band.
   */
  sessionFile?: string | null;
  /** Path to the current-model pointer, relative to boxRoot. Default: .callback-box/chat-model.json. */
  modelFile?: string;
  /** Extra env vars merged into the Claude subprocess env. */
  extraEnv?: Record<string, string>;
  /** Called once when Claude assigns a new session ID. Used for per-session bookkeeping. */
  onSessionIdAssigned?: (sessionId: string) => Promise<void> | void;
  /**
   * Pre-set the session id (skips loading from `sessionFile`). Used by the
   * registry to construct an instance bound to a specific existing session.
   */
  initialSessionId?: string;
  /** Injectable spawner — real by default; tests inject the fake. */
  spawner?: ClaudeChatSpawner;
  /**
   * Skip the `generateDocs` bootstrap step inside `startProcess`. Useful in
   * tests where the box isn't a fully-initialized callback-box, and in
   * activity sessions where the host box's docs aren't relevant to the
   * mode. Defaults to false (main chat behavior).
   */
  skipBootstrap?: boolean;
}

export const CHAT_SYSTEM_PROMPT = `You are in CALLBACK_BOX_CHAT_MODE.

You are a conversational assistant for this Callback Box — an agent-managed personal workspace where the filesystem is state and Git is history.

ABOUT THIS BOX:
- Data is stored as XML card files (\`Name.type.card\`) validated by schemas, in directories that reflect lifecycle stage
- \`box/inbox/\` — incoming items to triage
- \`box/jobs/\` — pending tasks for background agents to process
- \`box/questions/\` — pending questions for the user
- \`store/archive/\` — processed/completed items, organized by topic
- \`store/todos/\` — active todo lists
- \`config/\` — box configuration, guides, procedures, schedules
- Use \`cb\` commands for card operations: \`cb create\`, \`cb mv\`, \`cb validate\`, \`cb rm\`
- Git commits are the authoritative record of what happened — commit your work with meaningful messages

BEHAVIOR:
- Be concise and conversational — this is chat, not a report
- You can read and modify any files in this box
- For large tasks (multi-file changes, research, long operations): create a job card in \`box/jobs/\` using \`cb create\` so a background agent handles it. See \`docs/generated/agent-guide.md\` for job card format.
- For small tasks (quick lookups, single edits, answers): just do them directly
- If the user speaks (\`<speech>\` input), always respond with speech
- If the user types (\`<typed>\` input), speech is optional
- When the user is speaking: before starting any task that takes more than a few seconds (file reads, tool calls, creating cards), send a brief \`<speech>\` message first explaining what you're about to do. The user sees tool activity but no text until you speak — silence while you work feels broken. Even "Let me look into that" is enough. Put the \`<speech>\` tag BEFORE any tool calls.

OUTPUT FORMAT:
Your response has two channels:
1. **Speech** — text inside \`<speech>\` tags is spoken aloud via TTS
2. **Display text** — everything outside \`<speech>\` tags is shown visually in the chat UI but NOT spoken

When the user is speaking, use speech as the primary response (1-3 sentences). Use display text to supplement with details too verbose to speak: lists, formatted data, links, tables. Display text supports Markdown. For simple conversational replies, speech alone is fine.

<example>
<speech>Here's a pasta carbonara recipe — pretty simple, about 30 minutes.</speech>

## Pasta Carbonara
- 200g spaghetti, 100g guanciale, 2 egg yolks + 1 whole egg, 50g pecorino, black pepper

1. Cook pasta in salted water
2. Crisp guanciale in a dry pan
3. Whisk eggs with cheese and pepper
4. Toss hot pasta with guanciale, then egg mixture off heat
</example>

SPEECH:
Wrap spoken text in \`<speech>\` tags. You can optionally add \`<instructions>\` inside the tag to adjust delivery — tone, pacing, emphasis. Only add instructions when the delivery matters; skip them for normal conversation.

<example>
<speech>I found three overdue items you might want to look at.
<instructions>Gentle, not urgent</instructions>
</speech>
</example>

Your default voice and base speaking style come from the personality card (\`<speaking-voice>\`) — \`docs/generated/card-personality.md\` lists available voices. For per-message overrides (alternate voices, replacing base instructions), see \`docs/generated/chat-voice.md\`.

INPUT FORMAT:
- User messages are wrapped in \`<speech>\` (voice) or \`<typed>\` (keyboard) tags
- The \`user\` attribute identifies the sender — multiple people may participate in the same chat
- **Voice input is transcribed** — spelling of names and technical terms may be wrong, and punctuation is added automatically by the transcription system. Interpret charitably; don't assume unusual spelling or punctuation is intentional.

IMAGES:
To display an image from the box filesystem: \`![description](api/files/<path>)\` where \`<path>\` is relative to the box root. The description is shown as a one-line caption under the image (truncated) and in full when the user clicks to zoom — so write it as a useful caption, not just a filename.

SHOWING FILES IN CHAT:
To show a file inline in the chat, use a view link: \`[label](view:<file-path>)\`
- \`[Meeting Notes](view:store/notes/meeting.md)\` — renders markdown inline
- \`[Recipe](view:store/archive/Pasta.recipe.card)\` — renders the card with its viewer
- The system picks the right viewer automatically based on file type
- Add \`?zoom\` to open as a companion panel alongside chat instead of inline:
  \`[Meeting Notes](view:store/notes/meeting.md?zoom)\`
  The companion panel stays visible while the user continues chatting. Use it for collaborative work.
- When a companion view is open, user messages include \`zoomed-view="view:..."\` so you know what they're looking at
- Views update live when the underlying file changes

For custom interactive dashboards, you can create \`.tsx\` view components — see \`docs/generated/views.md\` for the full API. Do NOT use \`view:\` links for custom views; those links are for file paths only.

SELF-NOTES:

User-position messages wrapped in \`<self-note>\` tags are records of background agent activity — usually a scheduled sub-agent run (daily rumination, weekly research, etc.). No one typed or spoke them; they are not user input. They exist so you're aware of what background work has happened and so the session transcript carries a trail of it.

The user is not present when a self-note arrives, and will not see an immediate reply. Any text you produce lands in the transcript as an asynchronous message for them to read when they next revisit chat — not a conversational response.

Given that:
- Default behavior is to produce nothing. A self-note is a record, not a request.
- Tool use can be appropriate (read a file, update state, create a follow-up job, set a schedule) when the note genuinely calls for it.
- Write text only if there's something worth surfacing when the user next looks at the chat — and write it as a message addressed to them later, not a reply in the moment.

Attributes: \`ref\` points to the script/procedure that produced the note; \`commit\` is the git commit with the full work. Use \`git show <commit>\` if you need details.

SCHEDULING:
To set a timer or reminder, include a \`<schedule>\` tag in your response text:
  \`<schedule in="20m" label="rice timer" alarm="1" announce="check rice timer">Tell the user to check the rice</schedule>\`

The tag attributes:
- \`in\` — duration until firing (e.g. "5m", "1h", "30s"). Precision is to the nearest minute.
- \`label\` — short name shown in UI and used for cancellation
- \`alarm="1"\` — play an alarm sound when it fires (omit for silent)
- \`announce="text"\` — text spoken aloud via TTS when it fires
- Tag content is context injected back to you when the schedule fires

When a schedule fires, you receive a \`<schedule-fired>\` message. To cancel: \`<cancel-schedule label="rice timer" />\`. Active schedules are listed in user messages.

Use schedules proactively, not just for explicit timer requests:
- Remind or follow up if the user doesn't respond after a while
- Check back on a topic you discussed ("How did that meeting go?")
- Encourage or nudge the user about something they mentioned wanting to do
- Monitor something over time (set a schedule, check, set another)
- Any situation where you'd want to "come back to this later"

COMMITS:
- If you make file changes, commit with a descriptive message.
- Do NOT add Co-Authored-By trailers — the system adds appropriate trailers automatically.`;

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSession:${context}]`, ...args);
}

/**
 * An image attachment pasted/uploaded by the user, addressable by numeric id
 * via `[imageN]` tokens in the message text.
 */
export interface ChatImage {
  id: number;
  mimeType: string;
  /** Raw base64 data (no data: URL prefix) */
  dataBase64: string;
}

export interface ChatSendInput {
  text: string;
  images?: ChatImage[];
}

/**
 * Build the content array for a single compose (text + image attachments).
 *
 * `[imageN]` tokens in the text are replaced with the corresponding image
 * block. Attachments whose token is absent from the text are appended at
 * the end. Unknown tokens (id not in attachments) are left as literal text.
 */
export function buildContentBlocks(
  input: ChatSendInput
): ChatMessageContent[] {
  const { text, images } = input;
  const attached = images ?? [];
  if (attached.length === 0) {
    return [{ type: "text", text }];
  }

  const byId = new Map<number, ChatImage>();
  for (const img of attached) byId.set(img.id, img);
  const used = new Set<number>();

  const blocks: ChatMessageContent[] = [];
  const tokenRe = /\[image(\d+)]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const idStr = match[1];
    if (!idStr) continue;
    const id = parseInt(idStr, 10);
    const img = byId.get(id);
    if (!img) continue; // leave orphan token as literal text in the next chunk
    if (match.index > cursor) {
      blocks.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.dataBase64,
      },
    } as ChatMessageContent);
    used.add(id);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    blocks.push({ type: "text", text: text.slice(cursor) });
  }

  // Append any unreferenced images at the end
  for (const img of attached) {
    if (used.has(img.id)) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.dataBase64,
      },
    } as ChatMessageContent);
  }

  // If only images were appended (no text at all), still include an empty
  // text marker so downstream filters can tell this was a user turn (not
  // PDF-plumbing). Shouldn't happen in practice since messages are wrapped
  // in <typed>/<speech> tags by the caller, but defensive.
  if (blocks.every((b) => b.type !== "text")) {
    blocks.unshift({ type: "text", text: "" });
  }

  return blocks;
}

export class ChatSession extends EventEmitter {
  private proc: ClaudeChatProcess | null = null;
  private sessionId: string | null = null;
  private boxRoot: string;
  private busy = false;
  private turnText = "";
  private messageQueue: ChatSendInput[] = [];
  private readonly options: ChatSessionOptions;
  private readonly sessionFile: string | null;
  private readonly modelFile: string;
  private readonly spawner: ClaudeChatSpawner;
  private mcpConfigPath: string | null = null;
  private currentModel: string | null = null;
  private controlRequestCounter = 0;

  constructor(boxRoot: string, options: ChatSessionOptions = {}) {
    super();
    this.boxRoot = boxRoot;
    this.options = options;
    this.sessionFile = options.sessionFile === undefined ? DEFAULT_SESSION_FILE : options.sessionFile;
    this.modelFile = options.modelFile ?? DEFAULT_MODEL_FILE;
    this.spawner = options.spawner ?? createClaudeChatSpawner();
    if (options.initialSessionId !== undefined) {
      this.sessionId = options.initialSessionId;
    } else {
      this.sessionId = this.loadSessionId();
    }
    this.currentModel = this.loadCurrentModel();
    if (this.sessionId) {
      log("init", `Loaded session: ${this.sessionId}`);
    } else {
      log("init", "No saved session, will create on first message");
    }
    if (this.currentModel) {
      log("init", `Loaded model override: ${this.currentModel}`);
    }
  }

  private loadCurrentModel(): string | null {
    const filePath = path.join(this.boxRoot, this.modelFile);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
          model: string | null;
        };
        return data.model ?? null;
      }
    } catch (e) {
      log("model", `Failed to load model file: ${e}`);
    }
    return null;
  }

  private saveCurrentModel(model: string | null): void {
    const filePath = path.join(this.boxRoot, this.modelFile);
    const dir = path.dirname(filePath);
    try {
      if (model === null) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return;
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({ model, savedAt: new Date().toISOString() })
      );
    } catch (e) {
      log("model", `Failed to save model file: ${e}`);
    }
  }

  private loadSessionId(): string | null {
    if (this.sessionFile === null) return null;
    const filePath = path.join(this.boxRoot, this.sessionFile);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
          sessionId: string;
        };
        return data.sessionId;
      }
    } catch (e) {
      log("session", `Failed to load session file: ${e}`);
    }
    return null;
  }

  private saveSessionId(sessionId: string): void {
    if (this.sessionFile === null) return;
    const filePath = path.join(this.boxRoot, this.sessionFile);
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          sessionId,
          savedAt: new Date().toISOString(),
        })
      );
      log("session", `Saved session ID: ${sessionId}`);
    } catch (e) {
      log("session", `Failed to save session file: ${e}`);
    }
  }

  /**
   * Resolve the system prompt for a new subprocess. Uses the options override
   * if provided; otherwise falls back to the main-chat default
   * (CHAT_SYSTEM_PROMPT + tzContext).
   */
  private async resolveSystemPrompt(): Promise<string> {
    if (this.options.systemPrompt !== undefined) {
      return this.options.systemPrompt(this.boxRoot);
    }
    const tzContext = await buildTimezoneContext(this.boxRoot);
    return CHAT_SYSTEM_PROMPT + tzContext;
  }

  /**
   * Write the mcpConfig option to a temp JSON file so it can be passed to
   * claude via --mcp-config. Returns the path, or null if no config set.
   * Caller is responsible for cleanup via cleanupMcpConfigFile().
   */
  private async writeMcpConfigFile(): Promise<string | null> {
    const cfg = this.options.mcpConfig;
    if (!cfg) return null;
    const file = path.join(os.tmpdir(), `cb-mcp-${process.pid}-${Date.now()}.json`);
    const contents = {
      mcpServers: {
        "cb-activity": { command: cfg.command, args: cfg.args, env: cfg.env },
      },
    };
    await writeFile(file, JSON.stringify(contents, null, 2));
    return file;
  }

  private cleanupMcpConfigFile(): void {
    if (this.mcpConfigPath === null) return;
    try {
      fs.unlinkSync(this.mcpConfigPath);
    } catch (_e) {
      // Best-effort cleanup; temp file will get swept by the OS eventually.
    }
    this.mcpConfigPath = null;
  }

  /**
   * Spawn the claude process with stream-json mode.
   */
  private async startProcess(): Promise<void> {
    if (this.proc) {
      log("start", "Process already running");
      return;
    }

    // Ensure agent docs are up to date (fast mtime-cached no-op if nothing changed)
    if (this.options.skipBootstrap !== true) {
      await generateDocs(this.boxRoot);
    }

    const systemPrompt = await this.resolveSystemPrompt();
    this.mcpConfigPath = await this.writeMcpConfigFile();

    log("start", "Spawning cb-claude with stream-json mode");

    const baseEnv = await buildScriptEnv(this.boxRoot, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CLAUDECODE: undefined,
    });
    const env: Record<string, string | undefined> = {
      ...baseEnv,
      ...(this.options.extraEnv ?? {}),
    };

    this.proc = this.spawner.spawn({
      cwd: this.boxRoot,
      systemPrompt,
      sessionIdToResume: this.sessionId ?? undefined,
      mcpConfigPath: this.mcpConfigPath ?? undefined,
      model: this.currentModel ?? undefined,
      env,
    });

    log("start", `Process spawned with PID: ${this.proc.pid}`);

    if (!this.proc.stdout) {
      log("error", "No stdout available");
      this.emit("error", new Error("Claude process has no stdout"));
      return;
    }

    const rl = readline.createInterface({
      input: this.proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as ChatMessage;
        this.handleMessage(msg);
      } catch (e) {
        log(
          "error",
          `Failed to parse JSON: ${e instanceof Error ? e.message : e}`
        );
      }
    });

    if (this.proc.stderr) {
      this.proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        log("stderr", text.trim());
      });
    }

    this.proc.on("close", (code) => {
      log("close", `Process exited with code: ${code}`);
      this.proc = null;
      this.busy = false;
      this.cleanupMcpConfigFile();
      this.emit("close", code);
      // If messages were queued while the (now-dead) subprocess was busy,
      // drain them into a fresh subprocess so they aren't stranded.
      // stop()/resetSession() clear the queue first, so this is a no-op on
      // intentional shutdown and only fires on unexpected death or restart().
      if (this.messageQueue.length > 0) {
        log("close", `Draining ${this.messageQueue.length} queued message(s) into fresh subprocess`);
        this.drainQueue();
      }
    });

    this.proc.on("error", (err) => {
      log("error", `Process error: ${err.message}`);
      this.proc = null;
      this.busy = false;
      this.cleanupMcpConfigFile();
      this.emit("error", err);
    });
  }

  private handleMessage(msg: ChatMessage): void {
    // Capture session ID from first message
    if (msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      log("session", `Got session ID: ${this.sessionId}`);
      this.saveSessionId(this.sessionId);
      if (this.options.onSessionIdAssigned !== undefined) {
        void Promise.resolve(this.options.onSessionIdAssigned(this.sessionId)).catch((e: unknown) => {
          log("session", `onSessionIdAssigned error: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }

    // Accumulate assistant text for schedule parsing
    if (msg.type === "assistant" && msg.message) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          this.turnText += block.text;
        }
      }
    }

    this.emit("message", msg);

    if (msg.type === "result") {
      log("done", `Turn complete, is_error: ${msg.is_error}`);
      const completedText = this.turnText;
      this.turnText = "";
      this.busy = false;
      this.emit("done", msg);
      if (completedText) {
        this.emit("turn-text", completedText);
      }
      this.drainQueue();
    }
  }

  /**
   * Queue a message for delivery after the current turn completes.
   * Accepts either a plain string (back-compat) or a ChatSendInput with images.
   */
  enqueue(message: string | ChatSendInput): void {
    const input: ChatSendInput = typeof message === "string"
      ? { text: message }
      : message;
    log("enqueue", `Queued message (${input.text.length} chars, ${(input.images ?? []).length} image(s), queue size: ${this.messageQueue.length + 1})`);
    this.messageQueue.push(input);
  }

  /**
   * Send queued messages after a turn completes.
   * Combines the queued inputs into a single turn — text joined with
   * blank lines, image attachments concatenated (with per-message id
   * offsets to prevent `[imageN]` token collisions).
   */
  private drainQueue(): void {
    if (this.messageQueue.length === 0) return;
    const queued = this.messageQueue.splice(0);
    log("drain", `Sending ${queued.length} queued message(s)`);

    const combinedImages: ChatImage[] = [];
    const combinedTextParts: string[] = [];
    let idOffset = 0;
    for (const q of queued) {
      const imgs = q.images ?? [];
      let text = q.text;
      if (imgs.length > 0 && idOffset > 0) {
        // Renumber `[imageN]` tokens in this message's text and the image ids
        // to avoid collisions with previously-queued messages.
        text = text.replace(/\[image(\d+)]/g, (_m, n: string) => {
          const id = parseInt(n, 10);
          return `[image${id + idOffset}]`;
        });
        for (const img of imgs) {
          combinedImages.push({ ...img, id: img.id + idOffset });
        }
      } else {
        for (const img of imgs) combinedImages.push(img);
      }
      combinedTextParts.push(text);
      // Advance offset past the highest id we've seen (ids are small, so
      // offsetting by count of images in this message is safe).
      idOffset += imgs.length;
    }
    this.send({ text: combinedTextParts.join("\n\n"), images: combinedImages });
  }

  /**
   * Send a message to claude. Starts the process if not running.
   * Returns false if a turn is already in progress.
   *
   * Accepts either a plain string (back-compat) or a ChatSendInput object
   * carrying the text plus any image attachments referenced by `[imageN]`
   * tokens in the text.
   */
  async send(message: string | ChatSendInput): Promise<boolean> {
    if (this.busy) {
      log("send", "Rejected — busy");
      return false;
    }

    if (!this.proc) {
      await this.startProcess();
    }

    if (!this.proc || !this.proc.stdin) {
      log("error", "Process not ready after start");
      return false;
    }

    this.busy = true;
    this.turnText = "";

    const input: ChatSendInput = typeof message === "string"
      ? { text: message }
      : message;

    const content = buildContentBlocks(input);

    const payload = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content,
      },
    });

    const imgCount = (input.images ?? []).length;
    log("send", `Sending message (${input.text.length} chars, ${imgCount} image(s), ${content.length} block(s))`);
    this.proc.stdin.write(payload + "\n");
    return true;
  }

  /**
   * Interrupt the current turn.
   */
  interrupt(): void {
    if (!this.proc || !this.proc.stdin) {
      log("interrupt", "No process to interrupt");
      return;
    }

    const controlRequest = JSON.stringify({
      type: "control_request",
      request_id: `interrupt_${Date.now()}`,
      request: { subtype: "interrupt" },
    });

    log("interrupt", "Sending interrupt");
    this.proc.stdin.write(controlRequest + "\n");
  }

  /**
   * Set the model for this chat session. Pass `null` to reset to the CLI default.
   * Stores the selection so it's re-applied after process restarts/session init.
   */
  setModel(model: string | null): void {
    this.currentModel = model;
    this.saveCurrentModel(model);
    if (this.proc && this.proc.stdin) {
      this.writeSetModelControl(model);
    }
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  private writeSetModelControl(model: string | null): void {
    if (!this.proc || !this.proc.stdin) return;
    this.controlRequestCounter += 1;
    const controlRequest = JSON.stringify({
      type: "control_request",
      request_id: `set_model_${this.controlRequestCounter}_${Date.now()}`,
      request: { subtype: "set_model", model },
    });
    log("set_model", `Sending set_model: ${model ?? "<default>"}`);
    this.proc.stdin.write(controlRequest + "\n");
  }

  /**
   * Load conversation history from the session log.
   */
  async getHistory(params?: { tail?: number; minRealUserMessages?: number }): Promise<{
    sessionId: string | null;
    entries: SessionEntry[];
    total: number;
  }> {
    if (!this.sessionId) {
      return { sessionId: null, entries: [], total: 0 };
    }

    const logPath = getSessionLogPath(this.boxRoot, this.sessionId);
    if (!fs.existsSync(logPath)) {
      return { sessionId: this.sessionId, entries: [], total: 0 };
    }

    const result = await parseSessionLog({ logPath });
    const { entries, total } = result;
    const effectiveTail = effectiveTailSize(entries, params);
    if (effectiveTail !== null && effectiveTail < entries.length) {
      return {
        sessionId: this.sessionId,
        entries: entries.slice(entries.length - effectiveTail),
        total,
      };
    }
    return {
      sessionId: this.sessionId,
      entries,
      total,
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this.proc !== null;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Stop the claude process gracefully. Clears the pending queue so the
   * close handler won't auto-drain into a fresh subprocess.
   */
  stop(): void {
    if (this.proc) {
      log("stop", "Stopping Claude process");
      this.messageQueue = [];
      if (this.proc.stdin) this.proc.stdin.end();
      this.proc.kill();
      this.proc = null;
      this.busy = false;
    }
  }

  /**
   * Restart the claude subprocess. Kills the current process (if any) but
   * preserves the session id and any queued messages — the close handler
   * drains the queue into the fresh subprocess so wedged sessions recover
   * without losing in-flight user messages.
   */
  restart(): void {
    if (!this.proc) {
      log("restart", "No process to restart");
      return;
    }
    log("restart", "Killing subprocess — close handler will drain any queued messages");
    if (this.proc.stdin) this.proc.stdin.end();
    this.proc.kill();
  }

  /**
   * Reset the session — stop the process and clear the saved session ID.
   * The next send() will start a fresh conversation.
   */
  resetSession(): void {
    log("reset", "Resetting session");
    this.stop();
    this.sessionId = null;
    if (this.sessionFile === null) return;
    const filePath = path.join(this.boxRoot, this.sessionFile);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log("reset", "Deleted session file");
      }
    } catch (e) {
      log("reset", `Failed to delete session file: ${e}`);
    }
  }
}
