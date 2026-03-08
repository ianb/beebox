/**
 * ChatThreadSession — Persistent Claude process for a single chat thread.
 *
 * Adapted from ChatSession (src/core/chat-session.ts) but:
 * - Targeted at a specific thread (not the whole box)
 * - Intercepts <chat-response> tags from agent output for immediate delivery
 * - Can be parked (killed but session ID preserved) and resumed
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import * as path from "node:path";
import type { ChatMessage } from "./chat-session.js";

// Path to the cb-claude wrapper that auto-adds plugins
const __dirname = import.meta.dirname;
const binDir = path.resolve(__dirname, "../../bin");
const cbClaudePath = path.join(binDir, "cb-claude");

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatThreadSession:${context}]`, ...args);
}

export interface ChatThreadSessionOptions {
  boxRoot: string;
  threadRef: string;
  chatDescription: string;
  sessionId?: string | undefined;
  /** Base URL for session viewer links, e.g. "https://example.com/mybox/chat" */
  sessionViewBaseUrl?: string | undefined;
}

/**
 * Build the system prompt for a chat thread session.
 */
function buildThreadSystemPrompt(opts: {
  threadRef: string;
  chatDescription: string;
  sessionViewBaseUrl?: string | undefined;
}): string {
  return `You are in CHAT_THREAD_MODE — a persistent conversational session for "${opts.chatDescription}".

MESSAGES:
- User messages arrive wrapped: <chat-message from="Person Name" ref="people/person-slug">their text</chat-message>
- "from" is the display name, "ref" points to the person's card in the box (may be absent for unknown senders).
- There may be multiple people in a group chat — check "from" to know who's talking.
- Respond with: <chat-response>your reply text</chat-response>

RESPONDING:
- Each <chat-response> is delivered IMMEDIATELY as its own message — you can and should send multiple responses per turn.
- ALWAYS acknowledge first, then work, then report results. The user is on mobile and sees nothing until your first <chat-response>.
  Example:
    <chat-message from="Ian">Can you check if the deploy finished?</chat-message>
    <chat-response>Checking now</chat-response>
    [do the work — read files, check status, etc.]
    <chat-response>Yes, it finished successfully about 10 minutes ago</chat-response>
- For simple questions that need no work, a single <chat-response> is fine.
- Keep each response SHORT — 1-3 sentences. This is mobile chat, not email.
- Do NOT use Markdown formatting (no **, no ##, no backticks) — it won't render. Use plain text. You CAN use emoji and unicode characters (→, •, —) for visual structure.
- Do NOT edit the thread file directly — the system archives messages automatically.

THREAD ARCHIVE:
- The conversation history is at: ${opts.threadRef}
- You can Read this file if you need to look back at earlier messages.
- New messages from the user are provided in your prompt; you don't need to re-read the thread for the latest message.

SCHEDULING:
- Use <schedule in="duration" label="name">message content</schedule> to set a short-term timer (minutes to hours).
- When it fires, you'll receive a <schedule-fired> message — respond normally via <chat-response>.
- Cancel with <cancel-schedule label="name"/>
- For longer-term reminders or recurring tasks, create a job card instead.

CAPABILITIES:
- You have full access to read and modify files in this box.
- For large tasks (multi-file changes, research, long operations): create a job card in box/jobs/ rather than doing everything inline.
- For small tasks (quick lookups, single edits, answers): just do them directly and report back via <chat-response>.

COMMIT DISCIPLINE:
- If you make file changes, commit them with a descriptive message.
- Include a Session trailer in commits.

SESSION LINK:${opts.sessionViewBaseUrl ? `
- This session can be viewed at: ${opts.sessionViewBaseUrl}?session=SESSION_ID
  (The actual session ID will be assigned after your first response.)` : ""}
- If the user asks to see what you're doing or follow along, share the session link via <chat-response>.
- Do NOT share it proactively — only when asked.`;
}

export class ChatThreadSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sessionId: string | null;
  private boxRoot: string;
  private threadRef: string;
  private chatDescription: string;
  private sessionViewBaseUrl: string | undefined;
  private busy = false;
  private turnResolve: (() => void) | null = null;
  /** Accumulated text from current assistant turn, for <chat-response> extraction */
  private turnText = "";
  /** Full turn text (not sliced by chat-response extraction) for schedule parsing */
  private fullTurnText = "";

  constructor(opts: ChatThreadSessionOptions) {
    super();
    this.boxRoot = opts.boxRoot;
    this.threadRef = opts.threadRef;
    this.chatDescription = opts.chatDescription;
    this.sessionId = opts.sessionId ?? null;
    this.sessionViewBaseUrl = opts.sessionViewBaseUrl;
  }

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
    ];

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    // System prompt only on new sessions (resume already has it)
    if (!this.sessionId) {
      const prompt = buildThreadSystemPrompt({
        threadRef: this.threadRef,
        chatDescription: this.chatDescription,
        sessionViewBaseUrl: this.sessionViewBaseUrl,
      });
      args.push("--append-system-prompt", prompt);
    }

    log("start", `Spawning for thread ${this.threadRef}${this.sessionId ? ` (resume ${this.sessionId})` : " (new)"}`);

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
        log("parse", `Failed to parse: ${e instanceof Error ? e.message : e}`);
      }
    });

    if (this.proc.stderr) {
      this.proc.stderr.on("data", (data: Buffer) => {
        log("stderr", data.toString().trim());
      });
    }

    this.proc.on("close", (code) => {
      log("close", `Process exited with code: ${code}`);
      this.proc = null;
      this.busy = false;
      this.emit("close", code);
      // Resolve any pending turn
      if (this.turnResolve) {
        this.turnResolve();
        this.turnResolve = null;
      }
    });

    this.proc.on("error", (err) => {
      log("error", `Process error: ${err.message}`);
      this.proc = null;
      this.busy = false;
      this.emit("error", err);
      if (this.turnResolve) {
        this.turnResolve();
        this.turnResolve = null;
      }
    });
  }

  private handleMessage(msg: ChatMessage): void {
    log("msg", `type=${msg.type}${msg.type === "assistant" ? ` blocks=${msg.message?.content?.length ?? 0}` : ""}`);

    // Capture session ID from first message
    if (msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      log("session", `Got session ID: ${this.sessionId}`);
      this.emit("session", this.sessionId);
    }

    // Accumulate text from assistant messages for <chat-response> extraction
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          this.turnText += block.text;
          this.fullTurnText += block.text;
          this.checkForResponses();
        }
      }
    }

    this.emit("message", msg);

    if (msg.type === "result") {
      // Final check for any remaining responses in the accumulated text
      this.checkForResponses();
      log("done", `Turn complete, is_error: ${msg.is_error}, turnText length: ${this.turnText.length}${this.turnText.length > 0 ? `, text: ${this.turnText.slice(0, 200)}` : ""}`);
      this.busy = false;
      this.emit("turn-text", this.fullTurnText);
      this.emit("done", msg);
      if (this.turnResolve) {
        this.turnResolve();
        this.turnResolve = null;
      }
    }
  }

  /**
   * Extract and emit any complete <chat-response>...</chat-response> blocks
   * from the accumulated turn text.
   */
  private checkForResponses(): void {
    const regex = /<chat-response>([\S\s]*?)<\/chat-response>/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(this.turnText)) !== null) {
      const text = match[1]!.trim();
      if (text) {
        this.emit("chat-response", text);
      }
      lastIndex = regex.lastIndex;
    }

    // Keep only the text after the last complete match (may contain a partial tag)
    if (lastIndex > 0) {
      this.turnText = this.turnText.slice(lastIndex);
    }
  }

  /**
   * Send a message and wait for the turn to complete.
   * Returns a promise that resolves when the agent finishes its turn.
   */
  send(message: string): Promise<void> {
    if (this.busy) {
      return Promise.reject(new Error("Session is busy"));
    }

    if (!this.proc) {
      this.startProcess();
    }

    if (!this.proc || !this.proc.stdin) {
      return Promise.reject(new Error("Process not ready"));
    }

    this.busy = true;
    this.turnText = "";
    this.fullTurnText = "";

    // On resumed sessions, remind about response format since the system prompt
    // may have been compacted away from context
    let fullMessage = message;
    if (this.sessionId) {
      let reminder = "[Reminder: wrap replies in <chat-response>your reply</chat-response> tags. Send an acknowledgment first if you'll do work.]";
      if (this.sessionViewBaseUrl) {
        reminder += `\n[Session link: ${this.sessionViewBaseUrl}?session=${this.sessionId}]`;
      }
      fullMessage = `${message}\n\n${reminder}`;
    }

    const payload = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: fullMessage }],
      },
    });

    log("send", `Sending message (${message.length} chars) to ${this.threadRef}`);
    this.proc.stdin.write(payload + "\n");

    return new Promise<void>((resolve) => {
      this.turnResolve = resolve;
    });
  }

  /**
   * Park the session: kill the process but preserve the session ID for later resume.
   */
  park(): string | null {
    const sessionId = this.sessionId;
    if (this.proc) {
      log("park", `Parking session ${sessionId}`);
      if (this.proc.stdin) this.proc.stdin.end();
      this.proc.kill();
      this.proc = null;
      this.busy = false;
    }
    return sessionId;
  }

  /**
   * Stop and clear the session entirely.
   */
  stop(): void {
    if (this.proc) {
      log("stop", "Stopping process");
      if (this.proc.stdin) this.proc.stdin.end();
      this.proc.kill();
      this.proc = null;
      this.busy = false;
    }
    this.sessionId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getThreadRef(): string {
    return this.threadRef;
  }

  isRunning(): boolean {
    return this.proc !== null;
  }

  isBusy(): boolean {
    return this.busy;
  }
}
