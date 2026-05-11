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

import { EventEmitter } from "node:events";
import { ChatSession, type ChatSessionOptions } from "./chat-session.js";
import {
  appendHistory,
  setMostActive,
} from "./chat-session-history.js";
import { createChatBackend, type ChatBackend } from "../services/claude-chat.js";

interface RegistryEntry {
  session: ChatSession;
  /** Last access (any API call). Used for idle cleanup. */
  lastActivity: number;
  /** Last time the subprocess was actually used. Used for LRU eviction. */
  lastSubprocessUse: number;
  /** Number of in-flight SSE listeners pinning this entry. */
  refCount: number;
}

export interface ChatSessionRegistryOptions {
  /**
   * Maximum number of subprocesses live at once. When exceeded, the LRU
   * subprocess is `stop()`-ed (the registry entry stays so the id can be
   * re-spawned later). Default: 2.
   */
  maxLiveProcesses?: number;
  /**
   * How long an entry can sit untouched (no requests, no SSE listeners)
   * before it gets dropped from the registry entirely. Default: 10 min.
   */
  idleTimeoutMs?: number;
  /**
   * Tick interval for the idle sweep. Default: 60s.
   */
  cleanupIntervalMs?: number;
  /**
   * Factory for the underlying ChatSession. Override for tests so that
   * backend / systemPrompt / etc. can be injected. The registry adds
   * `initialSessionId`, `sessionFile: null`, and `onSessionIdAssigned`
   * on top of whatever this returns.
   */
  buildSessionOptions?: (sessionId: string | null) => ChatSessionOptions;
  /**
   * Shared backend for every ChatSession this registry creates. Lets
   * sessions share a warm-pool slot. Default: a fresh `createChatBackend()`.
   * Tests pass a fake backend here.
   */
  backend?: ChatBackend;
}

const DEFAULT_MAX_LIVE = 2;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSessionRegistry:${context}]`, ...args);
}

export class ChatSessionRegistry extends EventEmitter {
  private readonly boxRoot: string;
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly maxLive: number;
  private readonly idleTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly buildSessionOptions: (sessionId: string | null) => ChatSessionOptions;
  private readonly backend: ChatBackend;
  private cleanupTimer: NodeJS.Timeout | null = null;
  /**
   * Tracks pre-id "new" sessions whose Claude assignment hasn't arrived yet.
   * Once `onSessionIdAssigned` fires, they're moved into `entries` under
   * the real id and removed from this list.
   */
  private readonly pending = new Set<ChatSession>();

  constructor(boxRoot: string, options: ChatSessionRegistryOptions = {}) {
    super();
    this.boxRoot = boxRoot;
    this.maxLive = options.maxLiveProcesses ?? DEFAULT_MAX_LIVE;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.buildSessionOptions = options.buildSessionOptions ?? ((_id) => ({}));
    this.backend = options.backend ?? createChatBackend();
  }

  /**
   * Pre-warm a Claude subprocess against the registry's default session
   * options so the next "new chat" send doesn't pay spawn + initialize
   * latency. Best-effort: failures are swallowed and the next send falls
   * back to a cold spawn.
   */
  async prewarm(): Promise<void> {
    if (this.backend.prewarm === undefined) return;
    try {
      const baseOpts = this.buildSessionOptions(null);
      const probe = new ChatSession(this.boxRoot, {
        ...baseOpts,
        backend: this.backend,
        sessionFile: null,
        skipBootstrap: true,
      });
      const startOpts = await probe.buildBackendStartOptions();
      await this.backend.prewarm(startOpts);
    } catch (e) {
      log("prewarm", `Prewarm failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Begin the periodic idle-cleanup tick. Caller is responsible for `stopCleanup()`. */
  startCleanup(): void {
    if (this.cleanupTimer !== null) return;
    this.cleanupTimer = setInterval(() => {
      this.sweepIdle();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
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

  /** Number of entries with a live subprocess. */
  liveCount(): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.session.isRunning()) n += 1;
    }
    return n;
  }

  /**
   * Get an existing session by id, or `null` if no entry exists. Does NOT
   * lazily create — callers that need creation use `getOrCreate`.
   */
  get(sessionId: string): ChatSession | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    entry.lastActivity = Date.now();
    return entry.session;
  }

  /**
   * Get an existing session, or build one bound to that id (resumes from
   * the on-disk JSONL on first send).
   */
  getOrCreate(sessionId: string): ChatSession {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing.session;
    }
    const baseOpts = this.buildSessionOptions(sessionId);
    const session = new ChatSession(this.boxRoot, {
      ...baseOpts,
      backend: baseOpts.backend ?? this.backend,
      sessionFile: null,
      initialSessionId: sessionId,
      onSessionIdAssigned: this.makeOnAssigned({
        knownId: sessionId,
        chained: baseOpts.onSessionIdAssigned,
      }),
    });
    this.entries.set(sessionId, {
      session,
      lastActivity: Date.now(),
      lastSubprocessUse: Date.now(),
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
  createNew(contextDir?: string): ChatSession {
    const baseOpts = this.buildSessionOptions(null);
    const session = new ChatSession(this.boxRoot, {
      ...baseOpts,
      backend: baseOpts.backend ?? this.backend,
      sessionFile: null,
      ...(contextDir !== undefined ? { contextDir } : {}),
      onSessionIdAssigned: this.makeOnAssigned({
        knownId: null,
        chained: baseOpts.onSessionIdAssigned,
        contextDir,
      }),
    });
    this.pending.add(session);
    log("create-new", `Pending new session created (pending=${this.pending.size}${contextDir ? `, contextDir=${contextDir}` : ""})`);
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
  }): (sessionId: string) => Promise<void> {
    const { knownId, chained, contextDir } = params;
    return async (sessionId: string): Promise<void> => {
      try {
        await appendHistory(this.boxRoot, {
          sessionId,
          ...(contextDir !== undefined ? { contextDir } : {}),
        });
        await setMostActive(this.boxRoot, sessionId);
      } catch (e) {
        log("on-assigned", `History/most-active write failed: ${e instanceof Error ? e.message : e}`);
      }

      // Re-key pending "new" sessions into the entries map under the real id.
      if (knownId === null) {
        let promoted: ChatSession | null = null;
        for (const s of this.pending) {
          if (s.getSessionId() === sessionId) {
            promoted = s;
            break;
          }
        }
        if (promoted) {
          this.pending.delete(promoted);
          if (!this.entries.has(sessionId)) {
            this.entries.set(sessionId, {
              session: promoted,
              lastActivity: Date.now(),
              lastSubprocessUse: Date.now(),
              refCount: 0,
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
   * Touch an entry — bumps its `lastActivity`. Call on every API request
   * against the session. Optionally also marks subprocess use, for LRU.
   */
  touch(sessionId: string, opts?: { subprocessUse?: boolean }): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const now = Date.now();
    entry.lastActivity = now;
    if (opts?.subprocessUse) {
      entry.lastSubprocessUse = now;
    }
  }

  /**
   * Increment the SSE-listener refcount; pins the entry against idle
   * cleanup while a stream is open. Returns a release function.
   */
  pin(sessionId: string): () => void {
    const entry = this.entries.get(sessionId);
    if (!entry) return () => {};
    entry.refCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.refCount = Math.max(0, entry.refCount - 1);
    };
  }

  /**
   * Mark a session as the "most-active" — what bare `/chat` resolves to.
   * Called on real activity (send / restart), not on history reads.
   */
  async markMostActive(sessionId: string): Promise<void> {
    await setMostActive(this.boxRoot, sessionId);
  }

  /**
   * Enforce the live-subprocess cap. Called before starting a subprocess
   * (which means: any time `send()` is about to spawn). If we're at the
   * cap, the LRU entry's subprocess is stopped (entry stays).
   */
  enforceLiveCap(currentSessionId: string): void {
    const live: Array<{ id: string; entry: RegistryEntry }> = [];
    for (const [id, entry] of this.entries) {
      if (entry.session.isRunning()) {
        live.push({ id, entry });
      }
    }
    // The session that's about to start is presumably already in `entries`
    // (getOrCreate ran), but it may or may not have a subprocess yet. The
    // cap counts processes about to exist.
    if (live.length < this.maxLive) return;

    // Sort live entries by lastSubprocessUse ascending; evict the oldest
    // one that isn't the current session and has no in-flight listeners.
    live.sort((a, b) => a.entry.lastSubprocessUse - b.entry.lastSubprocessUse);
    for (const candidate of live) {
      if (candidate.id === currentSessionId) continue;
      if (candidate.entry.refCount > 0) continue;
      log("evict", `Stopping subprocess for ${candidate.id} (LRU under cap)`);
      candidate.entry.session.stop();
      return;
    }
    log("evict", `Live cap reached but no evictable candidate (refcounts: ${live.map((l) => `${l.id}=${l.entry.refCount}`).join(", ")})`);
  }

  /**
   * Drop entries with no recent activity and no active SSE listeners.
   * Their subprocesses are stopped and their entries removed.
   */
  private sweepIdle(): void {
    const cutoff = Date.now() - this.idleTimeoutMs;
    for (const [id, entry] of this.entries) {
      if (entry.lastActivity > cutoff) continue;
      if (entry.refCount > 0) continue;
      log("sweep", `Idle eviction of ${id}`);
      entry.session.stop();
      this.entries.delete(id);
    }
  }

  /**
   * Tear down all entries. Call on server shutdown.
   */
  shutdown(): void {
    this.stopCleanup();
    for (const [id, entry] of this.entries) {
      log("shutdown", `Stopping ${id}`);
      entry.session.stop();
    }
    this.entries.clear();
    for (const s of this.pending) s.stop();
    this.pending.clear();
  }

}
