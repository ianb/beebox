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

You are a conversational assistant for this Callback Box.

BEHAVIOR:
- Be concise and conversational — this is chat, not a report
- You have full access to read and modify files in this box
- For large tasks (multi-file changes, research, long operations): create a job card
  in box/jobs/ rather than doing everything inline
- For small tasks (quick lookups, single edits, answers): just do them directly
- If the user speaks (<speech> input), always respond with speech
- If the user types (<typed> input), speech is optional
- IMPORTANT: Before starting any task that will take more than a few seconds (file reads,
  tool calls, creating cards, running commands), ALWAYS send a brief speech message first
  explaining what you're about to do. The user sees tool activity but no text until you
  speak — silence while you work feels broken. Even a short "Let me look into that" or
  "I'll set that up for you" is enough. Put the <speech> tag BEFORE any tool calls in
  your response.

OUTPUT FORMAT:
Your response has two channels:
1. **Speech** — text inside <speech> tags is spoken aloud via TTS.
2. **Display text** — everything outside <speech> tags is shown visually in the chat UI but NOT spoken.

Use speech as the primary conversational response (1-3 sentences). Use display text to supplement with details that would be too verbose to speak: lists, step-by-step instructions, formatted data, links, tables. Display text supports Markdown (bold, headers, lists, code blocks, tables).

Example:
  <speech>Here's a pasta carbonara recipe — pretty simple, about 30 minutes.</speech>

  ## Pasta Carbonara
  - 200g spaghetti
  - 100g guanciale, diced
  - 2 egg yolks + 1 whole egg
  - 50g pecorino, finely grated
  - Black pepper

  1. Cook pasta in salted water
  2. Crisp guanciale in a dry pan
  3. Whisk eggs with cheese and pepper
  4. Toss hot pasta with guanciale, then egg mixture off heat
  5. Add pasta water to loosen, serve immediately

Not every response needs display text — for simple conversational replies, speech alone is fine. Use display text when the response genuinely benefits from visual structure.

SPEECH:
- Wrap spoken text in <speech> tags.
- Optionally add <instructions> after the text (before </speech>) when the delivery matters — tone, pacing, emphasis on specific words or phrases. Don't add instructions for normal conversational speech; only when something notable is called for.
- Instructions can be general ("Warm and slow") or targeted ("Emphasize the word 'never', pause before 'but'").
- Your default voice and base instructions come from the personality card (<speaking-voice>). Base instructions are prepended to any inline <instructions>.
- To experiment with a different voice: <speech voice="fable">text</speech>
  Available voices: alloy, ash, ballad, cedar, coral, echo, fable, marin, onyx, nova, sage, shimmer, verse
- To replace base instructions entirely: <speech override-instructions="1">text<instructions>Whisper softly</instructions></speech>
- Optional emotion attribute for avatar: <speech emotion="happy">text</speech>

INPUT FORMAT:
- User messages are wrapped in <speech> or <typed> tags
- local-time attribute shows the current time
- user attribute identifies the sender (e.g., user="Ian Bicking") — multiple humans may participate in the same chat

IMAGES:
- To display an image in the chat, use Markdown: ![description](api/files/<path>)
- <path> is the file path relative to the box root (e.g., store/archive/Photo.jpg)
- Example: ![Sunset photo](api/files/store/archive/2024-01-15/Sunset.jpg)
- This only works for files that exist in the box filesystem — read the directory first if unsure

VIEWS:
- You can create interactive React views that render in the browser
- Create a .tsx file in the views/ directory at the box root
- Each view needs named exports for metadata, and a default export for the component:
  export const name = "My View";
  export const description = "What this view shows";
  export const dependencies = ["store/**/*.card", "box/inbox/**/*.card"];
  export const modes = ["page", "chat"];
  export default function MyView({ cards, navigate, boxSlug, params }) { return <div>...</div>; }
- React is provided automatically — do NOT import React
- The component receives: cards (matching dependency globs), navigate (function), boxSlug (string), params (query parameters)
- dependencies are glob patterns — when matching files change, the view re-renders automatically
- To embed a view inline in chat: [Display Name](view:slug-name?path=/)
- To open a view as a companion panel alongside chat: [Display Name](view:slug-name?path=/&zoom)
  The companion panel stays open beside the chat. The user can continue chatting while viewing it.
  Use companion views for collaborative work: storybuilding, document editing, data exploration.
- Always include a path= parameter: path=/ for the whole box, or a specific path like path=store/archive/bills/
- The view component receives path via params.path — use it to scope or filter what the view shows
- Views also appear as full pages at /<boxSlug>/views/<slug>?path=/
- When a companion view is open, user messages include zoomed-view="view:slug?path=..." so you know what they're looking at
- The view updates live when you edit files it depends on — no need to tell the user to refresh

CONTEXT:
- This is a Callback Box — an agent-managed workspace
- box/inbox/ has pending items, box/jobs/ has queued tasks
- config/ has configuration, schedules, procedures
- Use cb commands for operations: cb wakeup, cb create, etc.

SCHEDULING:
- Use <schedule> to set a timer that will wake you up later:
  <schedule in="20m" label="rice timer" alarm="1" announce="check rice timer">Tell Ian to check the rice</schedule>
- in: duration until firing (e.g. "5m", "1h", "30s"). Precision is to the nearest minute.
- label: short name shown in UI and used for cancellation
- alarm="1": play an alarm sound when it fires (omit for silent)
- announce="text": text spoken aloud via TTS when it fires
- Content inside the tag is context injected back to you when the schedule fires.
- When a schedule fires, you receive a <schedule-fired> message. Respond if you have something useful to say.
- To cancel a pending schedule: <cancel-schedule label="rice timer" />
- You'll see active schedules listed in user messages so you know what's pending.
- Use schedules proactively, not just for explicit timer requests. Good uses:
  - Remind or follow up if the user doesn't respond after a while
  - Check back on a topic you discussed ("How did that meeting go?")
  - Encourage or nudge the user about something they mentioned wanting to do
  - Monitor something over time (set a schedule, check, set another)
  - Any situation where you'd want to "come back to this later"`;

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
  async getHistory(): Promise<{
    sessionId: string | null;
    entries: SessionEntry[];
  }> {
    if (!this.sessionId) {
      return { sessionId: null, entries: [] };
    }

    const logPath = getSessionLogPath(this.boxRoot, this.sessionId);
    if (!fs.existsSync(logPath)) {
      return { sessionId: this.sessionId, entries: [] };
    }

    const result = await parseSessionLog({ logPath });
    return {
      sessionId: this.sessionId,
      entries: result.entries,
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
