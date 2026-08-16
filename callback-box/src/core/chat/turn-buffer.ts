/**
 * Resumable per-turn output buffer.
 *
 * The per-turn agent stream used to be piped straight to a hijacked socket; if
 * that socket dropped mid-turn the streamed text was gone, recoverable only
 * once the turn finished and the transcript was refetched. This buffer decouples
 * the turn's output from any one client connection: the send route captures the
 * session's messages here with monotonic `seq` numbers, and the `chat.turnStream`
 * subscription replays from a client's last-seen seq, then streams live — so a
 * dropped WebSocket resumes mid-turn from exactly where it left off.
 *
 * It is an optimization over the durable transcript, never the only copy: the
 * ring is bounded and finished turns are GC'd after a reconnect window, so a
 * resume that asks for evicted frames (or an unknown turn) is told to resync,
 * and the client falls through to a full history refetch.
 *
 * Keyed by a server-minted `turnId` (unique), so it needs no box scoping and a
 * "new" session (whose real id arrives mid-stream) works the same as a resumed
 * one.
 */

import type { ChatMessage } from "./session/index.js";

export interface TurnFrame {
  seq: number;
  msg: ChatMessage;
}

/** Frame-count co-limit — enough for a long turn's small deltas. */
const MAX_FRAMES = 4000;
/**
 * Serialized payload co-limit. Eight MiB preserves ordinary delta-heavy turns
 * while bounding large tool inputs and images to a single-digit MiB per turn.
 */
const MAX_BYTES = 8 * 1024 * 1024;
/** How long a finished turn stays resumable for a reconnecting client. */
const FINISHED_TTL_MS = 60_000;

export class TurnBuffer {
  readonly turnId: string;
  private frames: TurnFrame[] = [];
  /** Serialized UTF-8 size for each frame at the matching array index. */
  private frameBytes: number[] = [];
  private bufferedBytes = 0;
  private seqCounter = 0;
  /** Highest seq dropped from the ring head; a resume at ≤ this has a gap. */
  private evictedThrough = 0;
  complete = false;
  /** Terminal error, if the turn failed before producing a result. */
  errored: string | null = null;
  /**
   * Bumped on every state change (push / finish / fail). A reader captures it
   * before draining, then passes it to `waitForChange`, which returns
   * immediately if anything changed in between — closing the drain-then-wait
   * window so a frame pushed mid-drain can't be missed until the next push.
   */
  private version = 0;
  private waiters = new Set<() => void>();

  constructor(turnId: string) {
    this.turnId = turnId;
  }

  push(msg: ChatMessage): void {
    this.seqCounter += 1;
    this.frames.push({ seq: this.seqCounter, msg });
    const bytes = Buffer.byteLength(JSON.stringify(msg), "utf8");
    this.frameBytes.push(bytes);
    this.bufferedBytes += bytes;
    while (this.frames.length > MAX_FRAMES || this.bufferedBytes > MAX_BYTES) {
      const dropped = this.frames.shift();
      const droppedBytes = this.frameBytes.shift();
      if (droppedBytes !== undefined) this.bufferedBytes -= droppedBytes;
      if (dropped) this.evictedThrough = dropped.seq;
    }
    this.bump();
  }

  finish(): void {
    this.complete = true;
    this.bump();
  }

  fail(error: string): void {
    this.errored = error;
    this.complete = true;
    this.bump();
  }

  /** Frames with seq strictly greater than `afterSeq`. */
  framesAfter(afterSeq: number): TurnFrame[] {
    return this.frames.filter((frame) => frame.seq > afterSeq);
  }

  /** True if resuming from `afterSeq` would skip frames already evicted. */
  hasGapAfter(afterSeq: number): boolean {
    return afterSeq < this.evictedThrough;
  }

  /** Snapshot the change counter before draining frames. */
  versionSnapshot(): number {
    return this.version;
  }

  /**
   * Resolve when the buffer changes after `sinceVersion`, the turn finishes, or
   * the signal aborts. Short-circuits if a change already happened since the
   * snapshot (no missed wakeup). The abort listener is removed on resolve so a
   * long turn doesn't accumulate one listener per wake.
   */
  waitForChange(signal: AbortSignal | undefined, sinceVersion: number): Promise<void> {
    if (this.complete || this.version !== sinceVersion || signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const settle = (): void => {
        this.waiters.delete(settle);
        signal?.removeEventListener("abort", settle);
        resolve();
      };
      this.waiters.add(settle);
      signal?.addEventListener("abort", settle, { once: true });
    });
  }

  private bump(): void {
    this.version += 1;
    for (const settle of [...this.waiters]) settle();
  }
}

const turns = new Map<string, TurnBuffer>();

export function createTurnBuffer(turnId: string): TurnBuffer {
  const buffer = new TurnBuffer(turnId);
  turns.set(turnId, buffer);
  return buffer;
}

/** Forget a turn immediately (e.g. its send failed before the turn ran). */
export function removeTurnBuffer(turnId: string): void {
  turns.delete(turnId);
}

export function getTurnBuffer(turnId: string): TurnBuffer | undefined {
  return turns.get(turnId);
}

/** Drop a finished turn after the reconnect window so memory doesn't grow. */
export function scheduleTurnCleanup(turnId: string): void {
  const timer = setTimeout(() => {
    turns.delete(turnId);
  }, FINISHED_TTL_MS);
  timer.unref();
}
