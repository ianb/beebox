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

const CHAT_SYSTEM_PROMPT = `You are in CALLBACK_BOX_CHAT_MODE.

You are a conversational assistant for this Callback Box.

BEHAVIOR:
- Be concise and conversational — this is chat, not a report
- You have full access to read and modify files in this box
- For large tasks (multi-file changes, research, long operations): create a job card
  in box/jobs/ rather than doing everything inline
- For small tasks (quick lookups, single edits, answers): just do them directly
- Use <speech> tags for parts you want spoken aloud via TTS
- Keep speech short (1-3 sentences). Use text outside speech for details.
- If the user speaks (<speech> input), always respond with speech
- If the user types (<typed> input), speech is optional

INPUT FORMAT:
- User messages are wrapped in <speech> or <typed> tags
- local-time attribute shows the current time

CONTEXT:
- This is a Callback Box — an agent-managed workspace
- box/inbox/ has pending items, box/jobs/ has queued tasks
- config/ has configuration, schedules, procedures
- Use cb commands for operations: cb wakeup, cb create, etc.`;

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSession:${context}]`, ...args);
}

export class ChatSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sessionId: string | null = null;
  private boxRoot: string;
  private busy = false;

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
  private startProcess(): void {
    if (this.proc) {
      log("start", "Process already running");
      return;
    }

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--append-system-prompt",
      CHAT_SYSTEM_PROMPT,
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

    this.emit("message", msg);

    if (msg.type === "result") {
      log("done", `Turn complete, is_error: ${msg.is_error}`);
      this.busy = false;
      this.emit("done", msg);
    }
  }

  /**
   * Send a message to claude. Starts the process if not running.
   * Returns false if a turn is already in progress.
   */
  send(message: string): boolean {
    if (this.busy) {
      log("send", "Rejected — busy");
      return false;
    }

    if (!this.proc) {
      this.startProcess();
    }

    if (!this.proc || !this.proc.stdin) {
      log("error", "Process not ready after start");
      return false;
    }

    this.busy = true;

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
