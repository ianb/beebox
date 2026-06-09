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

import type { ChatMessage } from "./chat-session.js";

export interface TurnFrame {
  seq: number;
  msg: ChatMessage;
}

/** Bounded ring size — enough for a long turn's deltas without unbounded memory. */
const MAX_FRAMES = 4000;
/** How long a finished turn stays resumable for a reconnecting client. */
const FINISHED_TTL_MS = 60_000;

export class TurnBuffer {
  readonly turnId: string;
  private frames: TurnFrame[] = [];
  private seqCounter = 0;
  /** Highest seq dropped from the ring head; a resume at ≤ this has a gap. */
  private evictedThrough = 0;
  complete = false;
  /** Terminal error, if the turn failed before producing a result. */
  errored: string | null = null;
  private waiters = new Set<() => void>();

  constructor(turnId: string) {
    this.turnId = turnId;
  }

  push(msg: ChatMessage): void {
    this.seqCounter += 1;
    this.frames.push({ seq: this.seqCounter, msg });
    if (this.frames.length > MAX_FRAMES) {
      const dropped = this.frames.shift();
      if (dropped) this.evictedThrough = dropped.seq;
    }
    this.wake();
  }

  finish(): void {
    this.complete = true;
    this.wake();
  }

  fail(error: string): void {
    this.errored = error;
    this.complete = true;
    this.wake();
  }

  /** Frames with seq strictly greater than `afterSeq`. */
  framesAfter(afterSeq: number): TurnFrame[] {
    return this.frames.filter((frame) => frame.seq > afterSeq);
  }

  /** True if resuming from `afterSeq` would skip frames already evicted. */
  hasGapAfter(afterSeq: number): boolean {
    return afterSeq < this.evictedThrough;
  }

  /** Resolve when new frames arrive / the turn finishes / the signal aborts. */
  waitForChange(signal: AbortSignal | undefined): Promise<void> {
    if (this.complete || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const settle = (): void => {
        this.waiters.delete(settle);
        resolve();
      };
      this.waiters.add(settle);
      signal?.addEventListener("abort", settle, { once: true });
    });
  }

  private wake(): void {
    for (const settle of [...this.waiters]) settle();
  }
}

const turns = new Map<string, TurnBuffer>();

export function createTurnBuffer(turnId: string): TurnBuffer {
  const buffer = new TurnBuffer(turnId);
  turns.set(turnId, buffer);
  return buffer;
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
