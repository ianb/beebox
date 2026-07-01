/**
 * ChatSession — Manages a long-lived SDK chat run for interactive chat.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` via `ChatBackend` (in
 * `services/claude-chat.ts`). One backend run per spawned chat — the
 * session pushes user messages and receives SDK message events one turn
 * after another, and resumes sessions across restarts via the SDK's
 * `resume` option.
 */

import { EventEmitter } from "node:events";
import { type FeatureMap } from "./chat-features.js";
import { FeatureStore, applyAgentTurnDeltas } from "./chat-session-features.js";
import {
  loadSessionHistory,
  type SessionHistoryResult,
} from "./chat-session-load-history.js";
import { generateDocs } from "./generate-docs.js";
import {
  createChatBackend,
  type ChatBackend,
  type ChatBackendRun,
  type ChatBackendStartOptions,
} from "../services/claude-chat.js";
import {
  CHAT_SYSTEM_PROMPT,
  NARRATION_OVERLAY,
} from "./chat-session-prompts.js";
import {
  accumulateAssistantText,
  adaptSdkMessage,
  buildContentBlocks,
  warnErroredTurn,
  type ChatImage,
  type ChatMessage,
  type ChatMessageContent,
  type ChatSendInput,
  type TaskEvent,
} from "./chat-session-messages.js";
import { createTurnDurabilityGate } from "./chat-session-transcript-sync.js";
import { recordTurnMarkerForSession } from "./chat-turn-marker.js";
import {
  combineQueuedInputs,
  deleteSessionFile,
  loadCurrentModel,
  loadSessionId,
  saveCurrentModel,
  saveSessionId,
  DEFAULT_MODEL_FILE,
} from "./chat-session-state.js";
import { acquireSessionRunLock, releaseSessionRunLock } from "./chat-session-run-lock.js";
import {
  buildBackendStartOptions as computeBackendStartOptions,
  composeTurnContent,
} from "./chat-session-start.js";
import type { ChatSessionOptions } from "./chat-session-options.js";
import { createHealthGate } from "./session-context.js";

export { CHAT_SYSTEM_PROMPT, NARRATION_OVERLAY, buildContentBlocks };
export type { ChatImage, ChatMessage, ChatMessageContent, ChatSendInput, TaskEvent };
export type { ChatSessionOptions };

const DEFAULT_SESSION_FILE = ".callback-box/chat-session-id.json";

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSession:${context}]`, ...args);
}

export class ChatSession extends EventEmitter {
  private run: ChatBackendRun | null = null;
  private sessionId: string | null = null;
  private boxRoot: string;
  private busy = false;
  /** Path of the chat-active lock held while a run is in flight, or null. */
  private chatLockPath: string | null = null;
  private turnText = "";
  /** Per-session gate keeping schedule-health a rare reminder (see `admitHealth`). */
  private readonly healthGate = createHealthGate();
  private messageQueue: ChatSendInput[] = [];
  private readonly options: ChatSessionOptions;
  private readonly sessionFile: string | null;
  private readonly modelFile: string;
  private readonly backend: ChatBackend;
  private currentModel: string | null = null;
  /** Chat-feature flag state: lazy-loaded map plus persistence + change events. */
  private readonly features: FeatureStore;
  /** Marker so the close listener can distinguish intentional shutdown
   *  (which clears the queue) from unexpected death (which drains it). */
  private intentionalStop = false;
  /**
   * Cached landmark binding. `undefined` = not resolved yet. `null` = resolved,
   * no binding. String = resolved binding. Set once on first `startRun` and
   * reused on drain/restart so we don't re-read history every turn.
   */
  private resolvedContextDir: string | null | undefined = undefined;
  /** Holds each turn's `result` until the transcript flush lands on disk. */
  private readonly durability = createTurnDurabilityGate(
    () => ({ boxRoot: this.boxRoot, sessionId: this.sessionId }),
  );

  constructor(boxRoot: string, options?: ChatSessionOptions) {
    super();
    options = options ?? {};
    this.boxRoot = boxRoot;
    this.options = options;
    this.sessionFile = options.sessionFile === undefined ? DEFAULT_SESSION_FILE : options.sessionFile;
    this.modelFile = options.modelFile ?? DEFAULT_MODEL_FILE;
    this.backend = options.backend ?? createChatBackend();
    if (options.initialSessionId !== undefined) {
      this.sessionId = options.initialSessionId;
    } else {
      this.sessionId = loadSessionId(this.boxRoot, this.sessionFile);
    }
    this.currentModel = loadCurrentModel(this.boxRoot, this.modelFile);
    this.features = new FeatureStore({
      boxRoot: this.boxRoot,
      getSessionId: () => this.sessionId,
      seedFeatures: options.seedFeatures,
      onChange: (features) => {
        this.emit("features-changed", { features });
      },
    });
    if (this.sessionId) {
      log("init", `Loaded session: ${this.sessionId}`);
    } else {
      log("init", "No saved session, will create on first message");
    }
    if (this.currentModel) {
      log("init", `Loaded model override: ${this.currentModel}`);
    }
  }

  /**
   * Compute the `ChatBackendStartOptions` this session would pass to
   * `backend.start()` for a fresh run (no resume id, no model override).
   * Exposed so the registry can pre-warm a backend with the same options
   * the next start() call would use. Caches the resolved landmark binding
   * so drain/restart paths don't re-read history every turn.
   */
  async buildBackendStartOptions(): Promise<ChatBackendStartOptions> {
    const { startOpts, resolvedContextDir } = await computeBackendStartOptions({
      boxRoot: this.boxRoot,
      options: this.options,
      resolvedContextDir: this.resolvedContextDir,
    });
    this.resolvedContextDir = resolvedContextDir;
    return startOpts;
  }

  /**
   * Start a new SDK chat run.
   */
  private async startRun(): Promise<void> {
    if (this.run !== null && !this.run.closed) {
      log("start", "Run already active");
      return;
    }

    // Ensure agent docs are up to date (fast mtime-cached no-op if unchanged).
    // Best-effort: a regen/commit failure here (e.g. a git-permission hiccup in
    // the template-sync commit) must not 500 the chat — log and proceed on-disk.
    if (this.options.skipBootstrap !== true) {
      await generateDocs(this.boxRoot).catch((e: unknown) => log("start", `generateDocs failed (continuing): ${e}`));
    }

    log("start", "Starting SDK chat run");

    // Hold a chat-active lock for the duration of the SDK run so that
    // `cb tick` (and any other housekeeping process) can detect a chat is
    // mid-response and defer commits that would race with agent writes.
    await this.acquireRunLock();

    const startOpts = await this.buildBackendStartOptions();

    const run = this.backend.start({
      ...startOpts,
      resumeSessionId: this.sessionId ?? undefined,
      model: this.currentModel ?? undefined,
    });
    this.run = run;
    this.intentionalStop = false;

    // Background loop: pump SDK messages into handleMessage. Capture errors
    // and emit as "error" events.
    void this.consumeMessages(run);
  }

  private async acquireRunLock(): Promise<void> {
    this.chatLockPath = await acquireSessionRunLock({
      boxRoot: this.boxRoot,
      sessionId: this.sessionId,
      currentLockPath: this.chatLockPath,
    });
  }

  private async releaseRunLock(): Promise<void> {
    this.chatLockPath = await releaseSessionRunLock(this.chatLockPath);
  }

  private async consumeMessages(run: ChatBackendRun): Promise<void> {
    try {
      for await (const sdkMsg of run.messages) {
        const msg = adaptSdkMessage(sdkMsg);
        if (msg === null) continue;
        this.durability.observe(msg);
        // Hold `result` until the transcript is flushed: consumers refetch
        // history the moment a turn ends, and the CLI writes the final
        // assistant entry ~150ms *after* emitting result.
        if (msg.type === "result") {
          await this.durability.awaitDurability();
          // Record the "since my last reply" marker before the queue drains.
          if (this.sessionId) await recordTurnMarkerForSession(this.boxRoot, this.sessionId);
        }
        this.handleMessage(msg);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log("error", `Run errored: ${err.message}`);
      this.emit("error", err);
    } finally {
      log("close", "Run ended");
      const wasIntentional = this.intentionalStop;
      this.run = null;
      this.busy = false;
      await this.releaseRunLock();
      this.emit("close", wasIntentional ? 0 : null);
      // Drain any messages queued while the run was busy into a fresh run,
      // unless this was an intentional stop (queue is already cleared).
      if (!wasIntentional && this.messageQueue.length > 0) {
        log("close", `Draining ${this.messageQueue.length} queued message(s) into fresh run`);
        this.drainQueue();
      }
    }
  }

  private handleMessage(msg: ChatMessage): void {
    // Capture session ID from first message
    if (msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      log("session", `Got session ID: ${this.sessionId}`);
      saveSessionId(this.boxRoot, { sessionFile: this.sessionFile, sessionId: this.sessionId });
      if (this.options.onSessionIdAssigned !== undefined) {
        void Promise.resolve(this.options.onSessionIdAssigned(this.sessionId)).catch((e: unknown) => {
          log("session", `onSessionIdAssigned error: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }
    // Background-task events fire between turns (no per-turn SSE attached), so
    // wireSession bridges them to the global event bus, not the per-turn stream.
    if (msg.type === "task" && msg.task) { this.emit("task", msg.task); return; }
    // Accumulate assistant text for schedule parsing
    this.turnText = accumulateAssistantText(this.turnText, msg);

    this.emit("message", msg);

    if (msg.type === "result") {
      log("done", `Turn complete, is_error: ${msg.is_error}`);
      if (msg.is_error === true) {
        warnErroredTurn({ sessionId: this.sessionId, msg });
      }
      const completedText = this.turnText;
      this.turnText = "";
      this.busy = false;
      this.emit("done", msg);
      if (completedText) {
        this.emit("turn-text", completedText);
        // Apply any <chat-app> mutation tags the agent emitted in this turn.
        // Done after the busy flag flips so listeners reacting to features-changed
        // can call setFeature etc. without hitting the in-flight check.
        applyAgentTurnDeltas(this.features, completedText);
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
    void this.send(combineQueuedInputs(queued));
  }

  /**
   * Send a message to claude. Starts a run if not running.
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

    const rawInput: ChatSendInput = typeof message === "string"
      ? { text: message }
      : message;

    // Composed BEFORE the run starts (it does filesystem I/O), and awaited
    // before run creation: observers of "a run exists" (drain-path tests,
    // callers polling the backend) expect run.send to follow run creation
    // with no awaits in between.
    const content = await composeTurnContent(this.boxRoot, {
      rawInput,
      features: this.features,
      sessionStart: this.sessionId === null,
      healthGate: this.healthGate,
    });

    if (this.run === null || this.run.closed) {
      await this.startRun();
    }

    if (this.run === null) {
      log("error", "Run not ready after start");
      return false;
    }

    this.busy = true;
    this.turnText = "";
    this.run.send(content);
    return true;
  }

  /**
   * Interrupt the current turn.
   */
  interrupt(): void {
    if (this.run === null || this.run.closed) {
      log("interrupt", "No run to interrupt");
      return;
    }
    log("interrupt", "Sending interrupt");
    void this.run.interrupt().catch((e: unknown) => {
      log("interrupt", `Interrupt failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /**
   * Set the model for this chat session. Pass `null` to reset to the SDK default.
   * Persisted to the model file so subsequent runs pick it up. Does NOT
   * change the model of an in-flight run — caller must restart.
   */
  setModel(model: string | null): void {
    this.currentModel = model;
    saveCurrentModel(this.boxRoot, { modelFile: this.modelFile, model });
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  /** Current feature map with defaults applied. Safe to call before features
   *  are loaded — returns pure defaults until the lazy load completes. */
  getFeatures(): FeatureMap {
    return this.features.get();
  }

  /**
   * Set a single feature. Validates against the registry; throws for unknown
   * features or illegal values. Persists to session history if a session id
   * has been assigned. Emits `features-changed`.
   */
  async setFeature(name: string, value: string): Promise<void> {
    await this.features.set(name, value);
  }

  /**
   * Load conversation history from the session log.
   */
  async getHistory(params?: { tail?: number; minRealUserMessages?: number }): Promise<SessionHistoryResult> {
    return loadSessionHistory(this.boxRoot, { sessionId: this.sessionId, params });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this.run !== null && !this.run.closed;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Stop the current run gracefully. Clears the pending queue so the
   * close handler won't auto-drain into a fresh run.
   */
  stop(): void {
    if (this.run !== null && !this.run.closed) {
      log("stop", "Stopping run");
      this.intentionalStop = true;
      this.messageQueue = [];
      void this.run.close();
    }
  }

  /**
   * Restart the current run. Closes the existing one (if any) but
   * preserves the session id and any queued messages — the close handler
   * drains the queue into the fresh run so wedged sessions recover
   * without losing in-flight user messages.
   */
  restart(): void {
    if (this.run === null || this.run.closed) {
      log("restart", "No run to restart");
      return;
    }
    log("restart", "Closing run — close handler will drain any queued messages");
    void this.run.close();
  }

  /**
   * Reset the session — stop the run and clear the saved session ID.
   * The next send() will start a fresh conversation.
   */
  resetSession(): void {
    log("reset", "Resetting session");
    this.stop();
    this.sessionId = null;
    deleteSessionFile(this.boxRoot, this.sessionFile);
  }
}
