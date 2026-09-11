/**
 * The durable voice-staging upload queue
 * (`docs/plans/resilient-voice-recording.md`, Track 2): enqueue* is what
 * Track 3's recorder and Track 4's submit flow call. State lives in
 * `voice-staging-queue-state.ts`; the drain loop that turns queued ops into
 * HTTP calls, with bounded retry, lives in `voice-staging-drainer.ts`. This
 * file is the public factory plus the app-wide singleton.
 *
 * `createVoiceStagingQueue` is the pure-injection factory
 * (`test/frontend/lib/audio/voice-staging-queue.doctest.md` drives it with an
 * in-memory store and a fake `send`); the exported functions below are thin
 * wrappers around one real singleton, created (and its drain started) the
 * moment this module is imported. `startVoiceStagingDrainer()` is the
 * explicit call the app shell makes at startup — see its call site — so a
 * reload or a later visit drains leftover ops even before any
 * recording-specific code has been touched.
 *
 * Two tabs of the same origin may drain the same recording concurrently.
 * That is safe on purpose: every op the server sees is idempotent (replay by
 * filename+bytes for a chunk, idempotent create/finalize) — see the plan's
 * Track 1. Nothing here single-flights across tabs.
 */

import { getApiBase } from "../../api";
import { VOICE_UPLOAD_BATCH_SECONDS, VOICE_QUEUE_BOUND_MS, type VoiceOpPayload } from "./voice-staging-queue-core";
import { loadPersisted, wake } from "./voice-staging-drainer";
import {
  createQueueState,
  countersFor,
  refreshStatus,
  persistPut,
  type Ctx,
  type Listener,
  type VoiceStagingQueueDeps,
  type VoiceStagingStatus,
  type VoiceStagingFailure,
} from "./voice-staging-queue-state";
import {
  createIndexedDbVoiceStagingStorage,
  createInMemoryVoiceStagingStorage,
  type VoiceStagingStorage,
  type StoredVoiceOp,
} from "./voice-staging-storage";
import { sendVoiceOp } from "./voice-staging-transport";

export { VOICE_UPLOAD_BATCH_SECONDS, VOICE_QUEUE_BOUND_MS };
export type { VoiceStagingStatus, VoiceStagingFailure };

export interface VoiceStagingQueue {
  enqueueCreate: (recordingId: string, opts: { targetSessionId: string }) => void;
  enqueueChunk: (recordingId: string, bytes: ArrayBuffer) => void;
  enqueueFinalize: (recordingId: string, opts: { hq: { emissionId: string; sessionId: string } | null }) => void;
  enqueueDiscard: (recordingId: string) => void;
  pendingChunkCount: (recordingId: string) => number;
  subscribeStatus: (listener: Listener) => () => void;
  getStatusSnapshot: () => ReadonlyMap<string, VoiceStagingStatus>;
  subscribeFailures: (listener: Listener) => () => void;
  getFailuresSnapshot: () => readonly VoiceStagingFailure[];
  /** False once storage fell back to in-memory — a reload will lose queued ops. */
  isPersistent: () => boolean;
  /** Wake the drainer now (online/visibility triggers, and tests). */
  wake: () => void;
}

function enqueue(ctx: Ctx, opts: { recordingId: string; payload: VoiceOpPayload }): void {
  const { recordingId, payload } = opts;
  const c = countersFor(ctx, recordingId);
  const seq = c.nextSeq;
  c.nextSeq += 1;
  const op: StoredVoiceOp = { apiBase: ctx.deps.apiBase(), recordingId, seq, payload, createdAt: ctx.deps.now(), attempts: 0 };
  ctx.state.ops = [...ctx.state.ops, op];
  refreshStatus(ctx);
  persistPut(ctx, op).catch((e: unknown) => {
    console.error(`[voice-staging] Failed to persist ${recordingId}#${String(seq)}:`, e);
  });
  wake(ctx);
}

/**
 * Build one queue instance. Exported for the doctest, which injects an
 * in-memory `VoiceStagingStorage` and a fake `send` instead of touching
 * IndexedDB or the network; the app's own singleton (below) is the only
 * caller in production.
 */
export function createVoiceStagingQueue(deps: VoiceStagingQueueDeps): VoiceStagingQueue {
  const ctx: Ctx = { deps, state: createQueueState(deps) };

  loadPersisted(ctx).catch((e: unknown) => console.error("[voice-staging] Failed to load persisted ops:", e));

  return {
    enqueueCreate: (recordingId, opts) => enqueue(ctx, { recordingId, payload: { kind: "create", targetSessionId: opts.targetSessionId } }),
    enqueueChunk: (recordingId, bytes) => {
      const c = countersFor(ctx, recordingId);
      const chunkIndex = c.nextChunkIndex;
      c.nextChunkIndex += 1;
      enqueue(ctx, { recordingId, payload: { kind: "chunk", chunkIndex, bytes } });
    },
    enqueueFinalize: (recordingId, opts) =>
      enqueue(ctx, { recordingId, payload: { kind: "finalize", chunkCount: countersFor(ctx, recordingId).nextChunkIndex - 1, hq: opts.hq } }),
    enqueueDiscard: (recordingId) => enqueue(ctx, { recordingId, payload: { kind: "discard" } }),
    pendingChunkCount: (recordingId) =>
      ctx.state.ops.filter((o) => o.recordingId === recordingId && o.payload.kind === "chunk").length,
    subscribeStatus: (listener) => {
      ctx.state.statusListeners.add(listener);
      return () => ctx.state.statusListeners.delete(listener);
    },
    getStatusSnapshot: () => ctx.state.status,
    subscribeFailures: (listener) => {
      ctx.state.failureListeners.add(listener);
      return () => ctx.state.failureListeners.delete(listener);
    },
    getFailuresSnapshot: () => ctx.state.failures,
    isPersistent: () => ctx.state.persistent,
    wake: () => wake(ctx),
  };
}

// --- The app-wide singleton -------------------------------------------------

let singleton: VoiceStagingQueue | null = null;

/**
 * IndexedDB when it's usable, in-memory when it isn't or is missing (private
 * browsing, blocked site data, plain Node under a doctest). Opening the
 * database is itself lazy (`voice-staging-storage.ts`), so choosing this
 * synchronously costs nothing; the state layer's `downgradeToInMemory` covers
 * the case where the first real use throws.
 */
function chooseRealStorage(): VoiceStagingStorage {
  return typeof indexedDB === "undefined" ? createInMemoryVoiceStagingStorage() : createIndexedDbVoiceStagingStorage();
}

function getSingleton(): VoiceStagingQueue {
  singleton ??= createVoiceStagingQueue({ storage: chooseRealStorage(), send: sendVoiceOp, apiBase: getApiBase, now: () => Date.now() });
  return singleton;
}

export function enqueueCreate(recordingId: string, opts: { targetSessionId: string }): void {
  getSingleton().enqueueCreate(recordingId, opts);
}
export function enqueueChunk(recordingId: string, bytes: ArrayBuffer): void {
  getSingleton().enqueueChunk(recordingId, bytes);
}
export function enqueueFinalize(recordingId: string, opts: { hq: { emissionId: string; sessionId: string } | null }): void {
  getSingleton().enqueueFinalize(recordingId, opts);
}
export function enqueueDiscard(recordingId: string): void {
  getSingleton().enqueueDiscard(recordingId);
}
export function pendingChunkCount(recordingId: string): number {
  return getSingleton().pendingChunkCount(recordingId);
}

export const voiceStagingStatus = {
  subscribe: (listener: Listener) => getSingleton().subscribeStatus(listener),
  getSnapshot: () => getSingleton().getStatusSnapshot(),
};
export const voiceStagingFailures = {
  subscribe: (listener: Listener) => getSingleton().subscribeFailures(listener),
  getSnapshot: () => getSingleton().getFailuresSnapshot(),
};

let drainerWired = false;

/**
 * Call once at app startup (`app-shell.tsx`) so a reload or a later visit
 * drains leftover ops even before any recording feature has been touched.
 * Merely importing this module already starts the singleton and its first
 * drain pass (the module-load call at the bottom of this file); this
 * additionally wires the `online`/`visibilitychange` re-triggers, which need
 * real browser globals a doctest doesn't have. Idempotent.
 */
export function startVoiceStagingDrainer(): void {
  getSingleton();
  if (drainerWired || typeof window === "undefined") return;
  drainerWired = true;
  window.addEventListener("online", () => getSingleton().wake());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") getSingleton().wake();
  });
}

getSingleton();
