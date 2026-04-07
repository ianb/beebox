/**
 * ChatSession - Manages a long-lived Claude process for interactive chat.
 *
 * Follows the Thinking Machine pattern: spawns claude CLI with
 * --output-format stream-json --input-format stream-json, keeps the
 * process alive between messages, and resumes sessions across restarts.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getSessionLogPath,
  parseSessionLog,
  type SessionEntry,
} from "../cli/lib/session.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import { generateDocs } from "./generate-docs.js";

// Path to the cb-claude wrapper that auto-adds plugins
const __dirname = import.meta.dirname;
const binDir = path.resolve(__dirname, "../../bin");
const cbClaudePath = path.join(binDir, "cb-claude");

/**
 * Content block in a Claude stream-json message.
 */
export interface ChatMessageContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
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

const SESSION_FILE = ".callback-box/chat-session-id.json";

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

Your default voice and base speaking style come from the personality card (\`<speaking-voice>\`). For advanced voice options (alternate voices, overriding base instructions, emotion attributes), see \`docs/generated/views.md\`.

INPUT FORMAT:
- User messages are wrapped in \`<speech>\` (voice) or \`<typed>\` (keyboard) tags
- The \`user\` attribute identifies the sender — multiple people may participate in the same chat
- **Voice input is transcribed** — spelling of names and technical terms may be wrong, and punctuation is added automatically by the transcription system. Interpret charitably; don't assume unusual spelling or punctuation is intentional.

IMAGES:
To display an image from the box filesystem: \`![description](api/files/<path>)\` where \`<path>\` is relative to the box root.

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

SCHEDULING:
To set a timer or reminder, include a \`<schedule>\` tag in your response text:
  \`<schedule in="20m" label="rice timer" alarm="1" announce="check rice timer">Tell Ian to check the rice</schedule>\`

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

export class ChatSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sessionId: string | null = null;
  private boxRoot: string;
  private busy = false;
  private turnText = "";
  private messageQueue: string[] = [];

  constructor(boxRoot: string) {
    super();
    this.boxRoot = boxRoot;
    this.sessionId = this.loadSessionId();
    if (this.sessionId) {
      log("init", `Loaded session: ${this.sessionId}`);
    } else {
      log("init", "No saved session, will create on first message");
    }
  }

  private loadSessionId(): string | null {
    const filePath = path.join(this.boxRoot, SESSION_FILE);
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
    const filePath = path.join(this.boxRoot, SESSION_FILE);
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
   * Spawn the claude process with stream-json mode.
   */
  private async startProcess(): Promise<void> {
    if (this.proc) {
      log("start", "Process already running");
      return;
    }

    // Ensure agent docs are up to date (fast mtime-cached no-op if nothing changed)
    await generateDocs(this.boxRoot);

    const tzContext = await buildTimezoneContext(this.boxRoot);
    const systemPrompt = CHAT_SYSTEM_PROMPT + tzContext;

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--append-system-prompt",
      systemPrompt,
    ];

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    log("start", "Spawning cb-claude with stream-json mode");

    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CLAUDECODE: undefined,
    };

    this.proc = spawn(cbClaudePath, args, {
      cwd: this.boxRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
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
      this.emit("close", code);
    });

    this.proc.on("error", (err) => {
      log("error", `Process error: ${err.message}`);
      this.proc = null;
      this.busy = false;
      this.emit("error", err);
    });
  }

  private handleMessage(msg: ChatMessage): void {
    // Capture session ID from first message
    if (msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      log("session", `Got session ID: ${this.sessionId}`);
      this.saveSessionId(this.sessionId);
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
   */
  enqueue(message: string): void {
    log("enqueue", `Queued message (${message.length} chars, queue size: ${this.messageQueue.length + 1})`);
    this.messageQueue.push(message);
  }

  /**
   * Send queued messages after a turn completes.
   * Combines multiple queued messages into a single turn.
   */
  private drainQueue(): void {
    if (this.messageQueue.length === 0) return;
    const queued = this.messageQueue.splice(0);
    const combined = queued.join("\n\n");
    log("drain", `Sending ${queued.length} queued message(s)`);
    this.send(combined);
  }

  /**
   * Send a message to claude. Starts the process if not running.
   * Returns false if a turn is already in progress.
   */
  async send(message: string): Promise<boolean> {
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

    const payload = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    });

    log("send", `Sending message (${message.length} chars)`);
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
   * Load conversation history from the session log.
   */
  async getHistory(params?: { tail?: number }): Promise<{
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
    const tail = params?.tail;
    if (tail && tail < entries.length) {
      return {
        sessionId: this.sessionId,
        entries: entries.slice(entries.length - tail),
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
   * Stop the claude process gracefully.
   */
  stop(): void {
    if (this.proc) {
      log("stop", "Stopping Claude process");
      if (this.proc.stdin) this.proc.stdin.end();
      this.proc.kill();
      this.proc = null;
      this.busy = false;
    }
  }

  /**
   * Reset the session — stop the process and clear the saved session ID.
   * The next send() will start a fresh conversation.
   */
  resetSession(): void {
    log("reset", "Resetting session");
    this.stop();
    this.sessionId = null;
    const filePath = path.join(this.boxRoot, SESSION_FILE);
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
