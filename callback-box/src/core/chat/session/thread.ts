/**
 * ChatThreadSession — Persistent SDK chat run for a single chat thread.
 *
 * Adapted from ChatSession (src/core/chat/session/index.ts) but:
 * - Targeted at a specific thread (not the whole box)
 * - Intercepts <chat-response> tags from agent output for immediate delivery
 * - Can be parked (run closed but session ID preserved) and resumed
 */

import { EventEmitter } from "node:events";
import { adaptSdkMessage, type ChatMessage } from "./messages.js";
import { assertNever, invariant } from "../../../lib/invariant.js";
import { buildTimezoneContext } from "../../box/config.js";
import { buildScriptEnv } from "../../script-env.js";
import {
  createChatBackend,
  type ChatBackend,
  type ChatBackendRun,
} from "../../../services/claude-chat.js";
import { pumpChatRun } from "./consume.js";
import { IDLE, afterTurnResult, lifecycleBusy, lifecycleRun, nextLifecycle, type ChatLifecycle } from "./lifecycle.js";

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatThreadSession:${context}]`, ...args);
}

class SessionBusyError extends Error {
  constructor() {
    super("Session is busy");
    this.name = "SessionBusyError";
  }
}

class RunNotReadyError extends Error {
  constructor() {
    super("Run not ready after start");
    this.name = "RunNotReadyError";
  }
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

export class ChatThreadSession extends EventEmitter {
  /** Run lifecycle — replaces the old run/busy pair. Never enters `stopping`:
   *  a thread session has no queue to protect, so stop/park close straight
   *  through to `idle`. */
  private state: ChatLifecycle = IDLE;
  private sessionId: string | null;
  private boxRoot: string;
  private threadRef: string;
  private chatDescription: string;
  private sessionViewBaseUrl: string | undefined;
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

  /** The current SDK run if one is open and not yet closed, else null. */
  private liveRun(): ChatBackendRun | null {
    const run = lifecycleRun(this.state);
    return run !== null && !run.closed ? run : null;
  }

  private async startRun(): Promise<void> {
    if (this.liveRun() !== null) { log("start", "Run already active"); return; }
    if (this.state.phase !== "idle") { log("start", "Run is closing; not starting a second run"); return; }
    this.state = nextLifecycle(this.state, { phase: "starting" });

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

    const run = this.backend.start({
      cwd: this.boxRoot,
      systemPrompt,
      resumeSessionId: this.sessionId ?? undefined,
      env,
    });
    this.state = nextLifecycle(this.state, { phase: "ready", run });

    void this.consumeMessages(run);
  }

  private consumeMessages(run: ChatBackendRun): Promise<void> {
    return pumpChatRun({
      run,
      adapt: adaptSdkMessage,
      onMessage: (msg) => this.handleMessage(msg),
      onError: (err) => {
        log("error", `Run errored: ${err.message}`);
        this.emit("error", err);
      },
      onClose: () => {
        log("close", "Run ended");
        if (this.state.phase !== "idle") this.state = nextLifecycle(this.state, { phase: "idle" });
        this.emit("close", null);
        this.resolveTurn();
      },
    });
  }

  /** Resolve the pending send() promise, if any. */
  private resolveTurn(): void {
    if (this.turnResolve) {
      this.turnResolve();
      this.turnResolve = null;
    }
  }

  private handleMessage(msg: ChatMessage): void {
    log("msg", `type=${msg.type}${msg.type === "assistant" ? ` blocks=${msg.message.content.length}` : ""}`);

    // Capture session ID from first message that carries one (the `unknown`
    // sentinel has none; a `user` echo's session_id is optional).
    if (msg.type !== "unknown" && msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      log("session", `Got session ID: ${this.sessionId}`);
      this.emit("session", this.sessionId);
    }

    // Every message type the SHARED adapter (messages.ts) can surface has an
    // explicit fate here — the thread path narrows away a few types that make
    // no sense for external chat delivery, but that narrowing is now ONE visible
    // switch instead of a divergent local adapter (Track 6 convergence). A
    // deliberate skip is a real `case`, never a silent fall-through.
    switch (msg.type) {
      case "assistant": {
        // Accumulate assistant text for <chat-response> extraction.
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            this.turnText += block.text;
            this.fullTurnText += block.text;
            this.checkForResponses();
          }
        }
        this.emit("message", msg);
        return;
      }
      case "result": {
        this.emit("message", msg);
        // Final check for any remaining responses in the accumulated text.
        this.checkForResponses();
        log("done", `Turn complete, is_error: ${msg.is_error}, turnText length: ${this.turnText.length}${this.turnText.length > 0 ? `, text: ${this.turnText.slice(0, 200)}` : ""}`);
        // Turn done: streaming → ready (run stays open, isBusy() flips false).
        this.state = afterTurnResult(this.state);
        this.emit("turn-text", this.fullTurnText);
        this.emit("done", msg);
        this.resolveTurn();
        return;
      }
      case "system":
        // `init` — session id already captured above. Forward for parity with
        // ChatSession; the pool ignores "message", so this is a no-op today.
        this.emit("message", msg);
        return;
      case "user":
        // The SDK echoes back the user turn we just sent. External chat (Telegram
        // etc.) has no UI that re-renders the user's own message, and it is NOT
        // assistant output, so it must never accumulate into <chat-response>
        // extraction. Forwarded as "message" for parity, but nothing consumes it.
        this.emit("message", msg);
        return;
      case "stream_event":
        // Partial-streaming deltas. The thread path delivers only COMPLETE
        // <chat-response> blocks parsed from finished assistant messages;
        // surfacing partials here would double-count against the assistant
        // message that follows. Deliberately dropped — this is the core
        // thread-path narrowing (the fork used to drop these at the adapter).
        log("skip", "Dropping stream_event partial — thread path delivers complete blocks only");
        return;
      case "task":
        // Background-task lifecycle events (task_started/progress/updated/
        // notification, normalized by the shared adapter). ChatSession bridges
        // these to the event bus for its task UI; the external-chat thread path
        // has no task surface, so they are deliberately dropped. Explicit so a
        // future task consumer is a conscious add, not an accidental revival.
        log("skip", `Dropping task event (phase=${msg.task.phase}) — thread path has no task surface`);
        return;
      case "unknown":
        // Wire-tolerance sentinel — already logged + counted at the adapter
        // boundary (unknownChatMessage). Forward so a consumer could observe SDK
        // drift; the thread path itself takes no action.
        this.emit("message", msg);
        return;
      default:
        return assertNever(msg);
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
      invariant(match[1] !== undefined, "regex's sole capture group always participates in a match");
      const text = match[1].trim();
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
    if (this.isBusy()) {
      throw new SessionBusyError();
    }

    if (this.liveRun() === null) {
      await this.startRun();
    }

    const run = this.liveRun();
    if (run === null) {
      return Promise.reject(new RunNotReadyError());
    }

    // ready → streaming.
    this.state = nextLifecycle(this.state, { phase: "streaming", run });
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
    run.send([{ type: "text", text: fullMessage }]);

    return new Promise<void>((resolve) => {
      this.turnResolve = resolve;
    });
  }

  /**
   * Park the session: close the run but preserve the session ID for later resume.
   * The close handler drives the phase back to `idle`.
   */
  park(): string | null {
    const sessionId = this.sessionId;
    const run = this.liveRun();
    if (run !== null) {
      log("park", `Parking session ${sessionId}`);
      void run.close();
    }
    return sessionId;
  }

  /**
   * Stop and clear the session entirely.
   */
  stop(): void {
    const run = this.liveRun();
    if (run !== null) {
      log("stop", "Stopping run");
      void run.close();
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
    return this.liveRun() !== null;
  }

  isBusy(): boolean {
    return lifecycleBusy(this.state);
  }
}
