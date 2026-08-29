/**
 * ChatSessionRegistry — pool of ChatSession instances keyed by sessionId.
 *
 * Replaces the singleton model. The frontend addresses every chat call by
 * sessionId; the registry lazily constructs an instance when a previously-
 * unseen id is referenced. Subprocesses are capped (LRU-evicted past
 * `maxLiveProcesses`); idle entries are dropped entirely after
 * `idleTimeoutMs`.
 *
 * The "most-active" pointer (`.callback-box/chat-session-id.json`) is what
 * bare `/chat` resolves to; it's updated on real activity (send / interrupt
 * / restart), not on every history read.
 *
 * "New chat" sessions are constructed without an id; the real id arrives
 * via `onSessionIdAssigned`, at which point the entry is re-keyed and the
 * id is appended to `chat-session-history.json`.
 */

import { makeLog } from "./log.js";
import { EventEmitter } from "node:events";
import { ChatSession, type ChatSessionOptions } from "./index.js";
import { setMostActive } from "./history.js";
import { createChatBackend, type ChatBackend } from "../../../services/claude-chat.js";
import { RegistryDeletionCoordinator } from "./registry-deletion.js";
import { ChatReservationStore, type ChatReservation, type ReserveResult } from "./reserve.js";
import type { AgentEngine } from "../../box/config.js";
import { reserveAndWarm, sweepExpiredReservations } from "./registry-reservations.js";
import { recordSessionStart } from "./session-start-record.js";
import { prewarmBackend } from "./registry-warm.js";
import { enforceLiveCap } from "./registry-cap.js";
import { pinEntry, pinSessionObject } from "./registry-pins.js";
import type { ChatSessionRegistryOptions, RegistryEntry } from "./registry-options.js";

export { SessionDeletingError } from "./deletion-state.js";
export type { ChatSessionRegistryOptions } from "./registry-options.js";

const DEFAULT_MAX_LIVE = 2;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

const log = makeLog("ChatSessionRegistry");

export class ChatSessionRegistry extends EventEmitter {
  private readonly boxRoot: string;
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly maxLive: number;
  private readonly idleTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly buildSessionOptions: (sessionId: string | null) => ChatSessionOptions;
  private readonly backend: ChatBackend;
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** Deadline clock (never CB_TIME-frozen); injectable for tests. */
  private readonly now: () => number;
  /**
   * Last chat activity (any accessor or prewarm). Drives warm-slot reaping:
   * once chat has been quiet past `idleTimeoutMs`, the sweep closes the
   * backend's warm slot so an idle box doesn't hold a Claude subprocess
   * around the clock; the next accessor re-warms.
   */
  private lastUse: number;
  /** True once `prewarm()` has been requested, so the sweep re-warms later. */
  private prewarmRequested = false;
  /**
   * Tracks pre-id "new" sessions whose Claude assignment hasn't arrived yet.
   * Once `onSessionIdAssigned` fires, they're moved into `entries` under
   * the real id and removed from this list.
   */
  private readonly pending = new Set<ChatSession>();
  /**
   * Pin counts held against pre-id "new" sessions (a turn is in flight before
   * the id lands). Folded into the entry's refCount on promotion so a fresh
   * turn can't be LRU-evicted in the window between send and id assignment.
   */
  private readonly pendingPins = new Map<ChatSession, number>();
  /**
   * Coined chat ids this box has accepted but whose conversations do not exist
   * yet. Held here rather than as registry entries because `sweepIdle` drops
   * entries after ten minutes and a reserved chat must stay addressable for as
   * long as the user might come back to it with a capture.
   */
  private readonly reservations = new ChatReservationStore(() => this.now());
  readonly deletion = new RegistryDeletionCoordinator({
    find: (sessionId) => this.entries.get(sessionId)?.session ?? null,
    findPending: (sessionId) => [...this.pending].find((session) => session.getSessionId() === sessionId) ?? null,
    remove: (sessionId, session) => {
      const entry = this.entries.get(sessionId);
      if (entry?.session === session) this.entries.delete(sessionId);
      this.pending.delete(session);
      this.pendingPins.delete(session);
    },
  });

  constructor(boxRoot: string, options?: ChatSessionRegistryOptions) {
    super();
    options = options ?? {};
    this.boxRoot = boxRoot;
    this.maxLive = options.maxLiveProcesses ?? DEFAULT_MAX_LIVE;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.buildSessionOptions = options.buildSessionOptions ?? ((_id) => ({}));
    this.backend = options.backend ?? createChatBackend();
    this.now = options.now ?? Date.now;
    this.lastUse = this.now();
  }

  /**
   * Record chat activity: bump `lastUse` and, if prewarming was ever requested
   * and the backend's warm slot has since been reaped, kick off a best-effort
   * re-warm. Cheap when already warm/warming (just the `hasWarm` check); the
   * re-`prewarm()` is fire-and-forget with its own error handling.
   */
  private noteActivity(): void {
    this.lastUse = this.now();
    if (this.prewarmRequested && this.backend.hasWarm?.() === false) void this.prewarm();
  }

  /**
   * Pre-warm a subprocess against the registry's default session options so
   * the next "new chat" send doesn't pay spawn + initialize latency.
   */
  async prewarm(): Promise<void> {
    this.prewarmRequested = true;
    this.lastUse = this.now();
    await prewarmBackend({
      boxRoot: this.boxRoot,
      backend: this.backend,
      baseOptions: this.buildSessionOptions(null),
    });
  }

  /**
   * Accept a client-coined chat id so the chat becomes addressable before its
   * first message, and warm a subprocess for it — see
   * `registry-reservations.ts`. Idempotent by id.
   */
  async reserve(opts: {
    sessionId: string;
    contextDir: string | null;
    seedFeatures: Record<string, string>;
    requestedEngine?: AgentEngine | undefined;
    model?: string | undefined;
  }): Promise<ReserveResult> {
    this.noteActivity();
    return reserveAndWarm({
      boxRoot: this.boxRoot,
      store: this.reservations,
      backend: this.backend,
      baseOptions: this.buildSessionOptions(null),
      ...opts,
    });
  }

  /** The reservation for this id, or null. */
  getReservation(sessionId: string): ChatReservation | null {
    return this.reservations.get(sessionId);
  }

  /**
   * The newest reserved-but-unstarted chat bound to `contextDir`, or null —
   * what "open this landmark's chat" falls back to when the history file has
   * no committed session for it yet (`ChatReservationStore.latestForDirectory`).
   */
  reservationForDirectory(contextDir: string): string | null {
    return this.reservations.latestForDirectory(contextDir);
  }

  /**
   * Whether this box can address the id at all — a live entry or a
   * reservation. The existence gates (send availability, capture and bulk
   * delivery targets) ask this instead of proving a chat exists by finding its
   * transcript, which a reserved chat has not written yet.
   */
  isKnownSession(sessionId: string): boolean {
    return this.entries.has(sessionId) || this.reservations.has(sessionId);
  }

  /** Begin the periodic idle-cleanup tick. Caller is responsible for `stopCleanup()`. */
  startCleanup(): void {
    if (this.cleanupTimer !== null) return;
    this.cleanupTimer = setInterval(() => {
      this.sweepIdle();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Number of registry entries (alive subprocesses or not). */
  size(): number {
    return this.entries.size;
  }

  /** Running/busy snapshot of every session held — entries plus the pre-id
   *  `pending` ones, which a single-session `status` query cannot name. Touches
   *  nothing: an observer that kept sessions warm would change what it measures. */
  snapshotAll(): { sessionId: string | null; running: boolean; busy: boolean }[] {
    const held = [...[...this.entries.values()].map((e) => e.session), ...this.pending];
    return held.map((s) => ({ sessionId: s.getSessionId(), running: s.isRunning(), busy: s.isBusy() }));
  }

  /** Number of entries with a live subprocess. */
  liveCount(): number {
    return [...this.entries.values()].filter((e) => e.session.isRunning()).length;
  }

  /**
   * Get an existing session by id, or `null` if no entry exists. Does NOT
   * lazily create — callers that need creation use `getOrCreate`.
   */
  get(sessionId: string): ChatSession | null {
    if (this.deletion.isBlocked(sessionId)) return null;
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    entry.lastActivity = this.now();
    this.noteActivity();
    return entry.session;
  }

  /**
   * Get an existing session, or build one bound to that id (resumes from
   * the on-disk JSONL on first send).
   */
  getOrCreate(sessionId: string): ChatSession {
    this.deletion.assertResumable(sessionId);
    this.noteActivity();
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = this.now();
      return existing.session;
    }
    const baseOpts = this.buildSessionOptions(sessionId);
    // A reserved id names a conversation the harness has not created yet: the
    // run is told to *use* this id, and the landmark binding and feature seeds
    // captured at reserve time ride with it (nothing else carries them — the
    // send only forwards those for a `"new"` session).
    const reservation = this.reservations.get(sessionId);
    const session = new ChatSession(this.boxRoot, {
      ...baseOpts,
      backend: baseOpts.backend ?? this.backend,
      sessionFile: null,
      initialSessionId: sessionId,
      ...(reservation !== null
        ? {
            coinedSessionId: sessionId,
            // The reservation's engine must reach the run's options, not only
            // the first-run record: start.ts resolves the engine from
            // options.engine, and without it a coined ?engine=claude start on
            // a codex-default box fell to the box default and tripped the
            // coined-must-be-Claude invariant (500, 2026-08-27).
            engine: reservation.engine,
            // This session keeps the accepted reservation record even if the
            // addressability TTL later expires. A pre-start feature toggle can
            // therefore never fall through to started-chat history and mint a
            // second engine answer.
            persistPendingFeatures: (updates) => { Object.assign(reservation.seedFeatures, updates); return true; },
            ...(reservation.contextDir !== null ? { contextDir: reservation.contextDir } : {}),
            ...(Object.keys(reservation.seedFeatures).length > 0 ? { seedFeatures: reservation.seedFeatures } : {}),
            onFirstRunStart: (id: string) => this.recordSessionStart(id, {
              ...(reservation.contextDir !== null ? { contextDir: reservation.contextDir } : {}),
              seedFeatures: reservation.seedFeatures,
              engine: reservation.engine,
            }),
          }
        : {}),
      onSessionIdAssigned: this.makeOnAssigned({
        knownId: sessionId,
        chained: baseOpts.onSessionIdAssigned,
      }),
    });
    // A model chosen before the first message rides the reservation; the id
    // already exists here, so the choice persists to the chat's own file the
    // moment it is applied.
    if (reservation?.model !== undefined) session.setModel(reservation.model);
    this.entries.set(sessionId, {
      session,
      lastActivity: this.now(),
      lastSubprocessUse: this.now(),
      refCount: 0,
    });
    log("create", `Created entry for ${sessionId} (size=${this.entries.size})`);
    return session;
  }

  /**
   * Construct a fresh session with no resume id. The real id arrives via
   * `onSessionIdAssigned` after the first send; the entry gets keyed under
   * that id at that point.
   *
   * Pass `contextDir` (box-relative) to bind the session to a landmark
   * directory — the SDK is spawned with `cwd` set to that directory and the
   * association is persisted to `chat-session-history` once the session id
   * is assigned, so resumes (here or on a fresh server boot) reapply it.
   */
  createNew(opts?: {
    contextDir?: string;
    seedFeatures?: Record<string, string>;
    /** Engine chosen for this chat before it has an id to record one against. */
    engine?: AgentEngine;
    /** Model chosen for this chat; persisted once the harness names it. */
    model?: string;
  }): ChatSession {
    opts = opts ?? {};
    this.noteActivity();
    const { contextDir, seedFeatures, engine, model } = opts;
    const baseOpts = this.buildSessionOptions(null);
    const session = new ChatSession(this.boxRoot, {
      ...baseOpts,
      backend: baseOpts.backend ?? this.backend,
      sessionFile: null,
      ...(contextDir !== undefined ? { contextDir } : {}),
      ...(seedFeatures !== undefined ? { seedFeatures } : {}),
      ...(engine !== undefined ? { engine } : {}),
      onSessionIdAssigned: this.makeOnAssigned({
        knownId: null,
        chained: baseOpts.onSessionIdAssigned,
        contextDir,
        seedFeatures,
        engine,
      }),
    });
    // The chat has no model file until the harness names it; `setModel`
    // records the choice in memory and the promotion at first message writes
    // it once there is a file to write (`ChatSession.handleMessage`).
    if (model !== undefined) session.setModel(model);
    this.pending.add(session);
    const seedSummary = seedFeatures && Object.keys(seedFeatures).length > 0 ? `, seedFeatures=${JSON.stringify(seedFeatures)}` : "";
    log("create-new", `Pending new session created (pending=${this.pending.size}${contextDir ? `, contextDir=${contextDir}` : ""}${seedSummary})`);
    return session;
  }

  /**
   * Build an `onSessionIdAssigned` callback: append to history file, set
   * most-active pointer, register the entry under the real id (for "new"
   * sessions), then chain to the base option's callback if any.
   */
  private makeOnAssigned(params: {
    knownId: string | null;
    chained?: ((sessionId: string) => Promise<void> | void) | undefined;
    contextDir?: string | undefined;
    seedFeatures?: Record<string, string> | undefined;
    engine?: AgentEngine | undefined;
  }): (sessionId: string) => Promise<void> {
    const { knownId, chained, contextDir, seedFeatures, engine } = params;
    return async (sessionId: string): Promise<void> => {
      await this.recordSessionStart(sessionId, {
        ...(contextDir !== undefined ? { contextDir } : {}),
        ...(seedFeatures !== undefined ? { seedFeatures } : {}),
        ...(engine !== undefined ? { engine } : {}),
      });

      // Re-key pending "new" sessions into the entries map under the real id.
      if (knownId === null) {
        const promoted = [...this.pending].find((s) => s.getSessionId() === sessionId);
        if (promoted) {
          this.pending.delete(promoted);
          // Carry any pin held while pending into the new entry's refCount so
          // an in-flight turn survives a concurrent send's LRU eviction.
          const carriedPins = this.pendingPins.get(promoted) ?? 0;
          this.pendingPins.delete(promoted);
          if (!this.entries.has(sessionId)) {
            this.entries.set(sessionId, {
              session: promoted,
              lastActivity: this.now(),
              lastSubprocessUse: this.now(),
              refCount: carriedPins,
            });
            log("promote", `Promoted pending session into registry as ${sessionId}`);
          }
        }
      }

      this.emit("session-assigned", { sessionId });
      if (chained) {
        await chained(sessionId);
      }
    };
  }

  /**
   * Record a chat's first real start (history, seeds, most-active, husk) and
   * retire its reservation — the chat is real now, so nothing is left for the
   * reservation to answer for. See `session-start-record.ts` for why both the
   * assigned-id and coined-id paths land here.
   */
  private async recordSessionStart(
    sessionId: string,
    params: {
      contextDir?: string | undefined;
      seedFeatures?: Record<string, string> | undefined;
      engine?: AgentEngine | undefined;
    },
  ): Promise<void> {
    // Released on the history write, not before it: until that row exists the
    // reservation is the only thing that can answer `chat.directoryFor` /
    // `chat.lastSessionForDirectory` for this chat, and the write is
    // deliberately quiet on failure — so releasing up front left a window, and
    // on a failed write a permanent state, where the chat was bound to a
    // landmark and nothing could say which.
    await recordSessionStart(this.boxRoot, {
      sessionId,
      ...params,
      onHistoryWritten: () => { this.reservations.release(sessionId); },
    });
  }

  /**
   * Touch an entry — bumps its `lastActivity`. Call on every API request
   * against the session. Optionally also marks subprocess use, for LRU.
   */
  touch(sessionId: string, opts?: { subprocessUse?: boolean }): void {
    this.noteActivity();
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.lastActivity = this.now();
    if (opts?.subprocessUse) entry.lastSubprocessUse = entry.lastActivity;
  }

  /** Pin an entry against idle cleanup while a stream is open (`registry-pins.ts`). */
  pin(sessionId: string): () => void {
    return pinEntry(this.entries.get(sessionId));
  }

  /** Pin a session for a turn, id or not (`registry-pins.ts`). */
  pinSession(session: ChatSession): () => void {
    return pinSessionObject({ session, entries: this.entries, pendingPins: this.pendingPins });
  }

  /**
   * Mark a session as the "most-active" — what bare `/chat` resolves to.
   * Called on real activity (send / restart), not on history reads.
   */
  async markMostActive(sessionId: string): Promise<void> {
    await setMostActive(this.boxRoot, sessionId);
  }

  /**
   * Enforce the live-subprocess cap before a send spawns a subprocess —
   * see `registry-cap.ts`.
   */
  enforceLiveCap(currentSessionId: string): void {
    enforceLiveCap(this.entries, { maxLive: this.maxLive, currentSessionId });
  }

  /**
   * Drop entries with no recent activity and no active SSE listeners.
   * Their subprocesses are stopped and their entries removed. Public so the
   * cleanup timer and tests (with an injected `now`) share one code path.
   */
  sweepIdle(): void {
    const cutoff = this.now() - this.idleTimeoutMs;
    for (const [id, entry] of this.entries) {
      if (entry.lastActivity > cutoff) continue;
      if (entry.refCount > 0) continue;
      log("sweep", `Idle eviction of ${id}`);
      entry.session.stop();
      this.entries.delete(id);
    }
    sweepExpiredReservations({ store: this.reservations, backend: this.backend });
    // Reap the warm slot once chat has gone quiet, so an idle box doesn't hold
    // a Claude subprocess around the clock. The next accessor re-warms it.
    if (this.backend.closeWarm !== undefined && this.now() - this.lastUse > this.idleTimeoutMs) {
      if (this.backend.hasWarm?.() === true) log("sweep", "Reaping idle warm slot");
      this.backend.closeWarm();
    }
  }

  /** Tear down all entries AND the backend's warm slot (a subprocess too).
   *  Call on server shutdown. */
  shutdown(): void {
    this.stopCleanup();
    this.backend.closeWarm?.();
    for (const [id, entry] of this.entries) {
      log("shutdown", `Stopping ${id}`);
      entry.session.stop();
    }
    this.entries.clear();
    for (const s of this.pending) s.stop();
    this.pending.clear();
  }
}
