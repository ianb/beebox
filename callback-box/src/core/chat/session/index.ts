/**
 * ChatSession — Manages a long-lived SDK chat run for interactive chat.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` via `ChatBackend` (in
 * `services/claude-chat.ts`). One backend run per spawned chat — the
 * session pushes user messages and receives SDK message events one turn
 * after another, and resumes sessions across restarts via the SDK's
 * `resume` option.
 */

import { makeLog } from "./log.js";
import { chatModelForEngine } from "../../../shared/chat-models.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { openChatRun } from "./start-run.js";
import { EventEmitter } from "node:events";
import { type FeatureMap } from "../features.js";
import { FeatureStore, applyAgentTurnDeltas } from "./features.js";
import { loadSessionHistory, type SessionHistoryResult, type SessionLogSlice } from "./load-history.js";
import { createCoinedRunState, type CoinedRunState } from "./coined-run.js";
import {
  createChatBackend,
  type ChatBackend,
  type ChatBackendRun,
  type ChatBackendStartOptions,
} from "../../../services/claude-chat.js";
import { CHAT_SYSTEM_PROMPT, NARRATION_OVERLAY } from "./prompts.js";
import {
  accumulateAssistantText,
  buildContentBlocks,
  warnErroredTurn,
  type ChatImage,
  type ChatMessage,
  type ChatMessageContent,
  type ChatSendInput,
  type TaskEvent,
} from "./messages.js";
import { createTurnDurabilityGate } from "./transcript-sync.js";
import { recordTurnMarkerForSession } from "../turn-marker.js";
import {
  captureAssignedSessionId,
  combineQueuedInputs,
  deleteSessionFile,
  loadCurrentModel,
  loadSessionId,
  saveCurrentModel,
  DEFAULT_MODEL_FILE,
} from "./state.js";
import { pumpSessionRun } from "./consume.js";
import { preflightChatBackend } from "../../agent/auth-preflight.js";
import { createRunLockHolder } from "./run-lock.js";
import {
  buildBackendStartOptions as computeBackendStartOptions,
  composeTurnContent,
} from "./start.js";
import type { ChatSessionOptions } from "./options.js";
import { createHealthGate } from "../../session-context.js";
import { IDLE, afterTurnResult, lifecycleBusy, lifecycleRun, nextLifecycle, type ChatLifecycle } from "./lifecycle.js";

export { CHAT_SYSTEM_PROMPT, NARRATION_OVERLAY, buildContentBlocks };
export type { ChatImage, ChatMessage, ChatMessageContent, ChatSendInput, TaskEvent };
export type { ChatSessionOptions };

const DEFAULT_SESSION_FILE = ".callback-box/chat-session-id.json";

const log = makeLog("ChatSession");

export class ChatSession extends EventEmitter {
  /** The run lifecycle — replaces the old run/busy/intentionalStop cluster. */
  private state: ChatLifecycle = IDLE;
  private sessionId: string | null = null;
  private boxRoot: string;
  private turnText = "";
  /** Per-session gate keeping schedule-health a rare reminder (see `admitHealth`). */
  private readonly healthGate = createHealthGate();
  private messageQueue: ChatSendInput[] = []; private preparingTurn = false;
  private readonly options: ChatSessionOptions;
  private readonly sessionFile: string | null;
  private modelFile: string | null;
  private readonly backend: ChatBackend;
  private currentModel: string | null = null;
  /** Chat-feature flag state: lazy-loaded map plus persistence + change events. */
  private readonly features: FeatureStore;
  /**
   * Cached landmark binding. `undefined` = not resolved yet. `null` = resolved,
   * no binding. String = resolved binding. Set once on first `startRun` and
   * reused on drain/restart so we don't re-read history every turn.
   */
  private resolvedContextDir: string | null | undefined = undefined;
  /** Coined-id state: does the next run create this conversation? See `coined-run.ts`. */
  private readonly coined: CoinedRunState;
  /** The chat-active lock held while a run is in flight (`run-lock.ts`). */
  private readonly runLock = createRunLockHolder(() => ({ boxRoot: this.boxRoot, sessionId: this.sessionId }));
  /** Holds each turn's `result` until the transcript flush lands on disk. */
  private readonly durability = createTurnDurabilityGate(
    () => ({ boxRoot: this.boxRoot, sessionId: this.sessionId }),
  );

  constructor(boxRoot: string, options?: ChatSessionOptions) {
    super();
    options = options ?? {};
    this.boxRoot = boxRoot;
    this.options = options;
    this.coined = createCoinedRunState(options);
    this.sessionFile = options.sessionFile === undefined ? DEFAULT_SESSION_FILE : options.sessionFile;
    this.modelFile = options.modelFile === undefined ? DEFAULT_MODEL_FILE : options.modelFile;
    this.backend = options.backend ?? createChatBackend();
    if (options.initialSessionId !== undefined) {
      this.sessionId = options.initialSessionId;
    } else {
      this.sessionId = loadSessionId(this.boxRoot, this.sessionFile);
    }
    this.currentModel = this.modelFile === null ? null : loadCurrentModel(this.boxRoot, this.modelFile);
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
      sessionId: this.sessionId,
      coinedRunPending: this.coined.pending,
    });
    this.resolvedContextDir = resolvedContextDir;
    return startOpts;
  }

  /** Move to a new lifecycle phase, asserting the transition is legal. */
  private transition(next: ChatLifecycle): void { this.state = nextLifecycle(this.state, next); }

  /** The current SDK run if one is open and not yet closed, else null. */
  private liveRun(): ChatBackendRun | null {
    const run = lifecycleRun(this.state);
    return run !== null && !run.closed ? run : null;
  }

  /**
   * Start a new SDK chat run.
   */
  private async startRun(): Promise<void> {
    if (this.liveRun() !== null) { log("start", "Run already active"); return; }
    if (this.state.phase !== "idle") {
      // A run is closing (handle already closed) but its consumeMessages finally
      // hasn't landed us in idle yet. Let that teardown complete rather than
      // racing a second run onto the same session.
      log("start", "Run is closing; not starting a second run");
      return;
    }

    // A coined session stops being "not created yet" the moment its transcript
    // exists — from this run or an earlier one — because the harness rejects a
    // session id it has already written (see reserve.ts).
    await this.coined.refresh({ boxRoot: this.boxRoot, sessionId: this.sessionId, contextDir: this.options.contextDir ?? null });

    // Preflight login before transitioning or locking; fakes skip this.
    const preview = await this.buildBackendStartOptions();
    if (!(await preflightChatBackend({ backend: this.backend, session: this, engine: preview.engine }))) return;
    const compatibleModel = chatModelForEngine(preview.engine ?? "claude", this.currentModel);
    this.currentModel = compatibleModel;
    this.transition({ phase: "starting" });

    // `openChatRun` either returns a live run or unwinds (lock released,
    // `onFailed` puts us back in `idle`) and throws — never leaves us stranded
    // in `starting`, which would read as permanently busy with no way out.
    const run = await openChatRun({
      backend: this.backend,
      boxRoot: this.boxRoot,
      skipBootstrap: this.options.skipBootstrap === true,
      startOptions: preview,
      // A coined id names a conversation with nothing to resume; the run
      // creates it under that id via `startOptions.coinedSessionId` instead.
      resumeSessionId: this.coined.pending ? undefined : this.sessionId ?? undefined,
      model: compatibleModel ?? undefined,
      acquireLock: () => this.runLock.acquire(),
      releaseLock: () => this.runLock.release(),
      onFailed: () => this.abandonStart(),
    });
    this.transition({ phase: "ready", run });
    this.coined.noteRunStarted(this.sessionId, this.options);

    // Background loop: pump SDK messages into handleMessage. Capture errors
    // and emit as "error" events.
    void this.consumeMessages(run);
  }

  /**
   * Return to `idle` after a run failed to start, and deal with anything that
   * queued behind it. While the start was in flight the session read as busy,
   * so a concurrent send enqueued and *persisted* its user message — leaving
   * that in the queue would strand it indefinitely (the queue only drains on a
   * turn result or a run close, neither of which will now happen) and let a
   * later send overtake it, so history and delivery order would disagree.
   * Draining retries once; if that start fails too, `drainQueue`'s own handler
   * reports it on the session rather than silently dropping the text.
   */
  private abandonStart(): void {
    this.transition({ phase: "idle" });
    this.drainQueue();
  }

  private consumeMessages(run: ChatBackendRun): Promise<void> {
    return pumpSessionRun(run, {
      durability: this.durability,
      boxRoot: this.boxRoot,
      getSessionId: () => this.sessionId,
      recordTurnMarker: (sessionId) => recordTurnMarkerForSession(this.boxRoot, sessionId),
      handleMessage: (msg) => this.handleMessage(msg),
      isStopping: () => this.state.phase === "stopping",
      toIdle: () => { if (this.state.phase !== "idle") this.transition({ phase: "idle" }); },
      releaseRunLock: () => this.runLock.release(),
      emitError: (err) => { this.emit("error", err); },
      emitClose: (code) => { this.emit("close", code); },
      queueLength: () => this.messageQueue.length,
      drainQueue: () => this.drainQueue(),
      log,
    });
  }

  private handleMessage(msg: ChatMessage): void {
    // Capture the SDK-assigned session id on the first message.
    const assigned = captureAssignedSessionId({ msg, current: this.sessionId, sessionFile: this.sessionFile, boxRoot: this.boxRoot, onAssigned: this.options.onSessionIdAssigned });
    if (assigned !== null) {
      this.sessionId = assigned;
      this.modelFile = this.options.modelFileForSession?.(assigned) ?? this.modelFile;
      if (this.modelFile !== null && this.currentModel !== null) saveCurrentModel(this.boxRoot, { modelFile: this.modelFile, model: this.currentModel });
      log("session", `Got session ID: ${assigned}`);
    }
    // Background-task events fire between turns (no per-turn SSE attached), so
    // wireSession bridges them to the global event bus, not the per-turn stream.
    if (msg.type === "task") { this.emit("task", msg.task); return; }
    // Accumulate assistant text for schedule parsing
    this.turnText = accumulateAssistantText(this.turnText, msg);

    this.emit("message", msg);

    if (msg.type === "result") {
      log("done", `Turn complete, is_error: ${msg.is_error}`);
      if (msg.is_error === true) warnErroredTurn({ sessionId: this.sessionId, msg });
      const completedText = this.turnText;
      this.turnText = "";
      // Turn done: streaming → ready (run stays open, isBusy() flips false).
      this.state = afterTurnResult(this.state);
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
    const input: ChatSendInput = typeof message === "string" ? { text: message } : message;
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
    // Nothing is awaiting this send, so a rejected run start (an FD-exhausted
    // spawn, say) would surface as an unhandled rejection and take the server
    // down. Report it on the session instead; the queued text is already spliced
    // out and is not re-queued, since a failing start would just fail again.
    void this.send(combineQueuedInputs(queued)).catch((e: unknown) => {
      log("drain", `Draining queued message(s) failed: ${errorMessage(e)}`);
      this.emit("error", e instanceof Error ? e : new Error(String(e)));
    });
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
    if (this.isBusy()) {
      log("send", "Rejected — busy");
      return false;
    }

    const rawInput: ChatSendInput = typeof message === "string" ? { text: message } : message; this.preparingTurn = true; try {

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

    if (this.liveRun() === null) {
      await this.startRun();
    }

    const run = this.liveRun();
    if (run === null) {
      log("error", "Run not ready after start");
      return false;
    }

    // ready → streaming.
    this.transition({ phase: "streaming", run });
    this.turnText = "";
    try {
      run.send(content);
    } catch (e) {
      // The dispatch itself failed. Step back to `ready` before rethrowing:
      // left in `streaming` the session reads as busy forever, with no result
      // coming to release it — the same wedge a failed start used to cause.
      this.state = afterTurnResult(this.state);
      log("send", `Dispatch failed, turn abandoned: ${errorMessage(e)}`);
      throw e;
    }
    return true;
    } finally { this.preparingTurn = false; }
  }

  /**
   * Interrupt the current turn.
   */
  interrupt(): void {
    const run = this.liveRun();
    if (run === null) {
      log("interrupt", "No run to interrupt");
      return;
    }
    log("interrupt", "Sending interrupt");
    void run.interrupt().catch((e: unknown) => {
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
    if (this.modelFile !== null) saveCurrentModel(this.boxRoot, { modelFile: this.modelFile, model });
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
   * Load a bounded window of conversation history from the session log.
   * The slice is explicit — there is no whole-transcript read to fall into.
   *
   * `fresh: true` (see `loadSessionHistory`) is for a caller that already
   * knows the transcript just changed — a post-turn-completion broadcast —
   * and must not join a scan that started before that change.
   */
  async getHistory(slice: SessionLogSlice, opts?: { fresh?: boolean }): Promise<SessionHistoryResult> {
    return loadSessionHistory(this.boxRoot, { sessionId: this.sessionId, slice, fresh: opts?.fresh ?? false });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this.liveRun() !== null;
  }

  isBusy(): boolean {
    return this.preparingTurn || lifecycleBusy(this.state);
  }

  /**
   * Stop the current run gracefully. Clears the pending queue so the
   * close handler won't auto-drain into a fresh run.
   */
  stop(): void {
    const run = this.liveRun();
    if (run !== null && (this.state.phase === "ready" || this.state.phase === "streaming")) {
      log("stop", "Stopping run");
      // → stopping: the close handler reads this phase as the intentional-stop
      // signal and won't drain the queue.
      this.transition({ phase: "stopping", run, wasBusy: lifecycleBusy(this.state) });
      this.messageQueue = [];
      void run.close();
    }
  }

  /**
   * Restart the current run. Closes the existing one (if any) but
   * preserves the session id and any queued messages — the close handler
   * drains the queue into the fresh run so wedged sessions recover
   * without losing in-flight user messages.
   */
  restart(): void {
    const run = this.liveRun();
    if (run === null) {
      log("restart", "No run to restart");
      return;
    }
    // Leave the phase as-is (ready/streaming): the close handler sees it's not
    // "stopping" and drains the queue into a fresh run.
    log("restart", "Closing run — close handler will drain any queued messages");
    void run.close();
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
