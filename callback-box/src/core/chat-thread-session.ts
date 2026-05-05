/**
 * ChatThreadSession — Persistent SDK chat run for a single chat thread.
 *
 * Adapted from ChatSession (src/core/chat-session.ts) but:
 * - Targeted at a specific thread (not the whole box)
 * - Intercepts <chat-response> tags from agent output for immediate delivery
 * - Can be parked (run closed but session ID preserved) and resumed
 */

import { EventEmitter } from "node:events";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatMessage, ChatMessageContent } from "./chat-session.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import { buildScriptEnv } from "./script-env.js";
import {
  CARD_VALIDATOR_PLUGIN_PATH,
  createChatBackend,
  type ChatBackend,
  type ChatBackendRun,
} from "../services/claude-chat.js";

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
  /** Injectable backend — real by default; tests inject the fake. */
  backend?: ChatBackend;
}

/**
 * Build the system prompt for a chat thread session.
 */
export function buildThreadSystemPrompt(opts: {
  threadRef: string;
  chatDescription: string;
  sessionViewBaseUrl?: string | undefined;
}): string {
  return `You are in CHAT_THREAD_MODE — participating in a real chat conversation (like Telegram or iMessage) for "${opts.chatDescription}".

This is a Callback Box — an agent-managed personal workspace where the filesystem is state and Git is history. You can read and modify any files in the box, create cards, run \`cb\` commands, etc. Only text inside \`<chat-response>\` tags is sent to the chat — everything else (tool calls, file reads, thinking) happens silently.

MESSAGES:
- User messages arrive as: \`<chat-message from="Person Name" ref="people/person-slug">their text</chat-message>\`
- This may be a group chat — multiple people can participate. The \`from\` attribute tells you who is talking. The \`ref\` attribute points to their person card in the box (may be absent for unknown senders).
- To reply, write: \`<chat-response>your reply text</chat-response>\`

RESPONDING:
- Each \`<chat-response>\` is delivered immediately as a separate message in the chat.
- You can send zero, one, or many responses per turn. Not every message needs a reply — sometimes acknowledging silently and doing the work is fine.
- If you'll do work before replying, send a quick acknowledgment first so the user isn't waiting in silence:
  \`<chat-response>Checking now</chat-response>\`
  [do the work]
  \`<chat-response>Yes, it finished about 10 minutes ago</chat-response>\`
- Keep each response SHORT — 1-3 sentences. This is mobile chat, not email.
- Do NOT use Markdown formatting (no **, no ##, no backticks) — it won't render. Plain text only. Emoji and unicode (→, •, —) are fine.
- Do NOT edit the thread file directly — the system archives messages automatically.

THREAD ARCHIVE:
- The conversation history is at: ${opts.threadRef}
- You can Read this file to look back at earlier messages. New messages are provided in the prompt.

SCHEDULING:
- Include a \`<schedule>\` tag in your response to set a timer: \`<schedule in="20m" label="name">context for when it fires</schedule>\`
- When it fires, you receive a \`<schedule-fired>\` message — respond via \`<chat-response>\`.
- Cancel with \`<cancel-schedule label="name"/>\`

LINKING:
- You can link the user to things in the box's web UI:${opts.sessionViewBaseUrl ? `
- This agent session: ${opts.sessionViewBaseUrl}?session=SESSION_ID (share only if the user asks to see what you're doing)` : ""}
- Cards and files are viewable at the box's web URL under the appropriate path.

COMMIT DISCIPLINE:
- If you make file changes, commit with a descriptive message and a Session trailer.
- Do NOT add Co-Authored-By trailers — the system adds appropriate trailers automatically.`;
}

/**
 * Adapt an SDK message into the stable ChatMessage wire shape we emit
 * to consumers. (Same logic as ChatSession's adapter, narrowed to the
 * subset this thread session cares about.)
 */
function adaptSdkMessage(msg: SDKMessage): ChatMessage | null {
  switch (msg.type) {
    case "system": {
      if (msg.subtype !== "init") return null;
      return { type: "system", subtype: "init", session_id: msg.session_id };
    }
    case "assistant": {
      const result: ChatMessage = {
        type: "assistant",
        session_id: msg.session_id,
        message: {
          role: msg.message.role,
          content: msg.message.content as ChatMessageContent[],
          ...(msg.message.stop_reason !== null && msg.message.stop_reason !== undefined
            ? { stop_reason: msg.message.stop_reason }
            : {}),
        },
      };
      if (msg.uuid) result.uuid = msg.uuid;
      return result;
    }
    case "result": {
      const r: ChatMessage = {
        type: "result",
        subtype: msg.subtype,
        session_id: msg.session_id,
        is_error: msg.is_error,
        duration_ms: msg.duration_ms,
        num_turns: msg.num_turns,
        total_cost_usd: msg.total_cost_usd,
      };
      if (msg.subtype === "success") r.result = msg.result;
      return r;
    }
    default:
      return null;
  }
}

export class ChatThreadSession extends EventEmitter {
  private run: ChatBackendRun | null = null;
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
  private readonly backend: ChatBackend;

  constructor(opts: ChatThreadSessionOptions) {
    super();
    this.boxRoot = opts.boxRoot;
    this.threadRef = opts.threadRef;
    this.chatDescription = opts.chatDescription;
    this.sessionId = opts.sessionId ?? null;
    this.sessionViewBaseUrl = opts.sessionViewBaseUrl;
    this.backend = opts.backend ?? createChatBackend();
  }

  private async startRun(): Promise<void> {
    if (this.run !== null && !this.run.closed) {
      log("start", "Run already active");
      return;
    }

    let systemPrompt = "";
    if (!this.sessionId) {
      const tzContext = await buildTimezoneContext(this.boxRoot);
      systemPrompt =
        buildThreadSystemPrompt({
          threadRef: this.threadRef,
          chatDescription: this.chatDescription,
          sessionViewBaseUrl: this.sessionViewBaseUrl,
        }) + tzContext;
    }

    const env = await buildScriptEnv(this.boxRoot, {
      CLAUDECODE: undefined,
    });

    log("start", `Starting run for thread ${this.threadRef}${this.sessionId ? ` (resume ${this.sessionId})` : " (new)"}`);

    this.run = this.backend.start({
      cwd: this.boxRoot,
      systemPrompt,
      resumeSessionId: this.sessionId ?? undefined,
      pluginPaths: [CARD_VALIDATOR_PLUGIN_PATH],
      env,
    });

    void this.consumeMessages(this.run);
  }

  private async consumeMessages(run: ChatBackendRun): Promise<void> {
    try {
      for await (const sdkMsg of run.messages) {
        const msg = adaptSdkMessage(sdkMsg);
        if (msg !== null) this.handleMessage(msg);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log("error", `Run errored: ${err.message}`);
      this.emit("error", err);
    } finally {
      log("close", "Run ended");
      this.run = null;
      this.busy = false;
      this.emit("close", null);
      if (this.turnResolve) {
        this.turnResolve();
        this.turnResolve = null;
      }
    }
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

    if (lastIndex > 0) {
      this.turnText = this.turnText.slice(lastIndex);
    }
  }

  /**
   * Send a message and wait for the turn to complete.
   * Returns a promise that resolves when the agent finishes its turn.
   */
  async send(message: string): Promise<void> {
    if (this.busy) {
      throw new Error("Session is busy");
    }

    if (this.run === null || this.run.closed) {
      await this.startRun();
    }

    if (this.run === null) {
      return Promise.reject(new Error("Run not ready after start"));
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

    log("send", `Sending message (${message.length} chars) to ${this.threadRef}`);
    this.run.send([{ type: "text", text: fullMessage }]);

    return new Promise<void>((resolve) => {
      this.turnResolve = resolve;
    });
  }

  /**
   * Park the session: close the run but preserve the session ID for later resume.
   */
  park(): string | null {
    const sessionId = this.sessionId;
    if (this.run !== null && !this.run.closed) {
      log("park", `Parking session ${sessionId}`);
      void this.run.close();
    }
    return sessionId;
  }

  /**
   * Stop and clear the session entirely.
   */
  stop(): void {
    if (this.run !== null && !this.run.closed) {
      log("stop", "Stopping run");
      void this.run.close();
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
    return this.run !== null && !this.run.closed;
  }

  isBusy(): boolean {
    return this.busy;
  }
}
