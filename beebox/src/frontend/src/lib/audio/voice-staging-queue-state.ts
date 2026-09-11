/**
 * Mutable state and the low-level mutators for the voice-staging queue
 * (`voice-staging-queue.ts`, Track 2 of
 * `docs/plans/resilient-voice-recording.md`). Split out to keep the queue
 * module's own line budget — this half owns "what does the queue contain and
 * how does a write to it get persisted"; the drain loop
 * (`voice-staging-drainer.ts`) owns "what does the queue do about it".
 */

import {
  createInMemoryVoiceStagingStorage,
  type VoiceStagingStorage,
  type StoredVoiceOp,
} from "./voice-staging-storage";
import type { LastOutcome, OpOutcome } from "./voice-staging-queue-core";

export interface VoiceStagingStatus {
  queuedOps: number;
  lastError?: string;
  terminal?: boolean;
}

export interface VoiceStagingFailure {
  recordingId: string;
  message: string;
  at: number;
}

export type Listener = () => void;

export interface VoiceStagingQueueDeps {
  storage: VoiceStagingStorage;
  send: (op: StoredVoiceOp) => Promise<OpOutcome>;
  apiBase: () => string;
  now: () => number;
}

/** All of one queue instance's mutable state. */
export interface QueueState {
  storage: VoiceStagingStorage;
  persistent: boolean;
  ops: StoredVoiceOp[];
  lastOutcome: LastOutcome | null;
  draining: boolean;
  drainTimer: ReturnType<typeof setTimeout> | null;
  warnedStorageFailure: boolean;
  counters: Map<string, { nextSeq: number; nextChunkIndex: number }>;
  recordingNotes: Map<string, { lastError?: string; terminal?: boolean }>;
  statusListeners: Set<Listener>;
  failureListeners: Set<Listener>;
  status: ReadonlyMap<string, VoiceStagingStatus>;
  failures: readonly VoiceStagingFailure[];
}

/** State plus the deps it was built with — bundled so every free function stays at 1-2 params. */
export interface Ctx {
  state: QueueState;
  deps: VoiceStagingQueueDeps;
}

export function createQueueState(deps: VoiceStagingQueueDeps): QueueState {
  return {
    storage: deps.storage,
    persistent: true,
    ops: [],
    lastOutcome: null,
    draining: false,
    drainTimer: null,
    warnedStorageFailure: false,
    counters: new Map(),
    recordingNotes: new Map(),
    statusListeners: new Set(),
    failureListeners: new Set(),
    status: new Map(),
    failures: [],
  };
}

function computeStatus(ctx: Ctx): ReadonlyMap<string, VoiceStagingStatus> {
  const map = new Map<string, VoiceStagingStatus>();
  for (const op of ctx.state.ops) {
    map.set(op.recordingId, { queuedOps: (map.get(op.recordingId)?.queuedOps ?? 0) + 1 });
  }
  for (const [recordingId, note] of ctx.state.recordingNotes) {
    const prev = map.get(recordingId) ?? { queuedOps: 0 };
    map.set(recordingId, {
      ...prev,
      ...(note.lastError !== undefined && { lastError: note.lastError }),
      ...(note.terminal !== undefined && { terminal: note.terminal }),
    });
  }
  return map;
}

export function refreshStatus(ctx: Ctx): void {
  ctx.state.status = computeStatus(ctx);
  for (const listener of ctx.state.statusListeners) listener();
}

/** IndexedDB (or whatever storage was given) failed — degrade to in-memory and say so once. */
export function downgradeToInMemory(ctx: Ctx, error: unknown): void {
  if (!ctx.state.warnedStorageFailure) {
    ctx.state.warnedStorageFailure = true;
    console.warn("[voice-staging] Storage failed; falling back to in-memory (uploads will not survive a reload):", error);
  }
  ctx.state.storage = createInMemoryVoiceStagingStorage();
  ctx.state.persistent = false;
  refreshStatus(ctx);
}

export async function persistPut(ctx: Ctx, op: StoredVoiceOp): Promise<void> {
  try {
    await ctx.state.storage.put(op);
  } catch (e) {
    downgradeToInMemory(ctx, e);
    await ctx.state.storage.put(op);
  }
}

export function countersFor(ctx: Ctx, recordingId: string): { nextSeq: number; nextChunkIndex: number } {
  let c = ctx.state.counters.get(recordingId);
  if (c === undefined) {
    c = { nextSeq: 0, nextChunkIndex: 1 };
    ctx.state.counters.set(recordingId, c);
  }
  return c;
}

export async function removeOp(ctx: Ctx, op: StoredVoiceOp): Promise<void> {
  ctx.state.ops = ctx.state.ops.filter((o) => !(o.recordingId === op.recordingId && o.seq === op.seq));
  refreshStatus(ctx);
  try {
    await ctx.state.storage.remove(op);
  } catch (e) {
    downgradeToInMemory(ctx, e);
  }
}

export async function dropRecording(ctx: Ctx, opts: { recordingId: string; message: string }): Promise<void> {
  const { recordingId, message } = opts;
  const toRemove = ctx.state.ops.filter((o) => o.recordingId === recordingId);
  ctx.state.ops = ctx.state.ops.filter((o) => o.recordingId !== recordingId);
  ctx.state.recordingNotes.set(recordingId, { terminal: true, lastError: message });
  ctx.state.failures = [...ctx.state.failures, { recordingId, message, at: ctx.deps.now() }];
  refreshStatus(ctx);
  for (const listener of ctx.state.failureListeners) listener();
  await Promise.allSettled(
    toRemove.map((o) =>
      ctx.state.storage.remove(o).catch((e: unknown) => {
        console.error(`[voice-staging] Failed to remove terminal op ${recordingId}#${String(o.seq)}:`, e);
      }),
    ),
  );
}
