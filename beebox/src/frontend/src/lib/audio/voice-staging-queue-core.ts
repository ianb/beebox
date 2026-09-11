/**
 * Pure decision core for the voice-staging upload queue
 * (`docs/plans/resilient-voice-recording.md`, Track 2). No I/O: it decides
 * what the drainer should do next given the current ops and the outcome of
 * whatever it last tried, and every branch is reached by
 * `test/frontend/lib/audio/voice-staging-queue-core.doctest.md`. The impure
 * shell (storage, HTTP) lives in `voice-staging-storage.ts` and
 * `voice-staging-queue.ts`.
 */

import { MAX_RETRIES, retryDelayMs } from "../trpc/transient";

/** How much audio the recorder batches into one `chunk` op (Track 3). */
export const VOICE_UPLOAD_BATCH_SECONDS = 15;

/** An op older than this fails terminally regardless of what it is — nothing retries forever. */
export const VOICE_QUEUE_BOUND_MS = 7 * 24 * 60 * 60 * 1000;

/** `create` seeds a voice recording; the client mints `recordingId` itself. */
export interface VoiceCreateOp {
  kind: "create";
  targetSessionId: string;
}

/** One ~15s batch of raw PCM, numbered by the queue at enqueue time (1-based). */
export interface VoiceChunkOp {
  kind: "chunk";
  chunkIndex: number;
  bytes: ArrayBuffer;
}

/** Seals the recording. `chunkCount` is the queue's own count of chunks it assigned. */
export interface VoiceFinalizeOp {
  kind: "finalize";
  chunkCount: number;
  hq: { emissionId: string; sessionId: string } | null;
}

/** Cancels an unsealed recording. A 404 on send means it is already gone — success. */
export interface VoiceDiscardOp {
  kind: "discard";
}

export type VoiceOpPayload = VoiceCreateOp | VoiceChunkOp | VoiceFinalizeOp | VoiceDiscardOp;

/**
 * One persisted op. `seq` orders every op within one recording (0 = create,
 * then chunks and finalize/discard in enqueue order) — strictly ascending,
 * never reused. `attempts` counts sends that have already failed transiently.
 */
export interface VoiceOp {
  recordingId: string;
  seq: number;
  payload: VoiceOpPayload;
  createdAt: number;
  attempts: number;
}

export type OpFailureKind = "transient" | "terminal";

/** What happened the last time the drainer sent (or tried to send) an op. */
export interface LastOutcome {
  recordingId: string;
  seq: number;
  at: number;
  kind: OpFailureKind;
}

/** The result of one send attempt, as the impure shell classifies it. */
export type OpOutcome =
  | { kind: "success" }
  | { kind: "transient"; error: unknown }
  | { kind: "terminal"; error: unknown };

/**
 * Generic over the op type so a caller whose ops carry extra fields (the
 * shell's `StoredVoiceOp`, which adds `apiBase`) gets that type back, rather
 * than being widened to the bare `VoiceOp` this module knows about.
 */
export type DrainStep<T extends VoiceOp = VoiceOp> =
  | { type: "idle" }
  | { type: "wait"; ms: number }
  | { type: "send"; op: T }
  | { type: "terminal"; recordingId: string; op: T; reason: "expired" | "rejected" };

export interface NextDrainStepOptions {
  now: number;
  /**
   * The shell's memory of each recording's most recent send attempt, keyed by
   * `recordingId` — one entry per recording, since only its earliest
   * surviving op is ever in flight. Keyed by recording rather than a single
   * scalar: two recordings can each be mid-backoff at once (one waiting out a
   * transient failure while an older-but-just-loaded recording's op is sent
   * first), and a single shared slot would let one recording's outcome
   * clobber another's — an unrelated success would wipe a still-active
   * backoff and cause an early resend before its wait elapsed.
   */
  lastOutcomes: ReadonlyMap<string, LastOutcome>;
  /** `VOICE_QUEUE_BOUND_MS` — an op this old fails terminally regardless of what it is. */
  boundMs: number;
}

/** A steady wait once the backoff schedule (`retryDelayMs`) runs out. */
const STEADY_STATE_RETRY_MS = 30_000;

function waitBeforeRetry(attempts: number): number {
  return attempts <= MAX_RETRIES ? retryDelayMs(attempts) : STEADY_STATE_RETRY_MS;
}

/** Each recording's earliest still-pending op — ops go strictly in `seq` order. */
function earliestOpsByRecording<T extends VoiceOp>(ops: readonly T[]): Map<string, T> {
  const earliest = new Map<string, T>();
  for (const op of ops) {
    const current = earliest.get(op.recordingId);
    if (current === undefined || op.seq < current.seq) earliest.set(op.recordingId, op);
  }
  return earliest;
}

/**
 * The oldest recording's earliest op — "oldest" meaning the smallest
 * `createdAt` among each recording's own earliest surviving op, so one
 * recording drains at a time and recordings are served in the order their
 * work started, not the order their ops happen to interleave in storage.
 */
function nextOp<T extends VoiceOp>(ops: readonly T[]): T | null {
  let best: T | null = null;
  for (const op of earliestOpsByRecording(ops).values()) {
    if (best === null || op.createdAt < best.createdAt) best = op;
  }
  return best;
}

/**
 * The next thing the drainer should do: send an op, wait, report a recording
 * as terminally failed, or sit idle. `lastOutcomes` is not persisted — a
 * reload naturally retries immediately, which is fine since nothing here
 * promises a fixed wall-clock schedule across a reload.
 */
export function nextDrainStep<T extends VoiceOp>(ops: readonly T[], options: NextDrainStepOptions): DrainStep<T> {
  const { now, lastOutcomes, boundMs } = options;
  const op = nextOp(ops);
  if (op === null) return { type: "idle" };

  if (now - op.createdAt >= boundMs) {
    return { type: "terminal", recordingId: op.recordingId, op, reason: "expired" };
  }

  const recordingOutcome = lastOutcomes.get(op.recordingId);
  const outcomeForThisOp = recordingOutcome !== undefined && recordingOutcome.seq === op.seq ? recordingOutcome : null;
  if (outcomeForThisOp !== null) {
    if (outcomeForThisOp.kind === "terminal") {
      return { type: "terminal", recordingId: op.recordingId, op, reason: "rejected" };
    } else {
      // Only two `OpFailureKind` members exist, so this else is "transient".
      const waitMs = waitBeforeRetry(op.attempts);
      const elapsed = now - outcomeForThisOp.at;
      if (elapsed < waitMs) return { type: "wait", ms: waitMs - elapsed };
    }
  }
  return { type: "send", op };
}
