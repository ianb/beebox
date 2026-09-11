/**
 * One voice recording's side of the staging queue
 * (`docs/plans/resilient-voice-recording.md`, Track 3): the recording is
 * staged to the box from its first PCM frame, whether or not a live
 * transcription socket exists.
 *
 * `VoiceStager` batches the worklet's ~300 ms frames into
 * {@link VOICE_UPLOAD_BATCH_SECONDS} of audio per `chunk` op. A
 * `StagedRecording` owns the whole queue lifecycle of one recording —
 * `create` at start, chunks as audio arrives, then exactly one `finalize`
 * (via {@link PendingRecording.seal}) or `discard`. The transcription actor
 * holds it while the segment records and hands it to the machine as a
 * {@link PendingRecording} when the segment ends; whoever receives it owes the
 * box one seal or discard.
 */

import { VOICE_UPLOAD_BATCH_SECONDS } from "./voice-staging-queue-core";

/** The worklet's format: 16 kHz mono s16le (`pcm-processor.worklet.js`). */
const PCM_BYTES_PER_SECOND = 16_000 * 2;

/** Bytes in one full `chunk` op: 15 s of audio = 480,000 bytes. */
export const VOICE_BATCH_BYTES = VOICE_UPLOAD_BATCH_SECONDS * PCM_BYTES_PER_SECOND;

/** What a recording sealed for HQ tells the box: which message, in which chat. */
export interface VoiceHqRequest {
  emissionId: string;
  sessionId: string;
}

/**
 * The sealing obligation a finished segment hands off in place of an audio
 * blob. Exactly one terminal call reaches the box: `seal` flushes the last
 * partial batch and finalizes (with an HQ request, or `null` for none);
 * `discard` deletes the recording. Both are idempotent, and the first
 * terminal call wins — a later call of the other kind is logged and ignored.
 */
export interface PendingRecording {
  readonly recordingId: string;
  seal: (hq: VoiceHqRequest | null) => void;
  discard: () => void;
}

/** The part of the staging queue a recording writes to (injected for tests). */
export interface VoiceStagingSink {
  enqueueCreate: (recordingId: string, opts: { targetSessionId: string | null }) => void;
  enqueueChunk: (recordingId: string, bytes: ArrayBuffer) => void;
  enqueueFinalize: (recordingId: string, opts: { hq: VoiceHqRequest | null }) => void;
  enqueueDiscard: (recordingId: string) => void;
}

/**
 * Batches PCM frames into exact {@link VOICE_BATCH_BYTES} chunks. A frame
 * that straddles a batch boundary is split, so every chunk but the last is
 * full-size and the bytes arrive in order with nothing dropped or repeated.
 */
export class VoiceStager {
  private readonly emit: (bytes: ArrayBuffer) => void;
  private batch = new Uint8Array(VOICE_BATCH_BYTES);
  private fill = 0;
  private totalBytes = 0;

  constructor(opts: { emit: (bytes: ArrayBuffer) => void }) {
    this.emit = opts.emit;
  }

  push(frame: ArrayBuffer): void {
    let rest = new Uint8Array(frame);
    this.totalBytes += rest.byteLength;
    while (rest.byteLength > 0) {
      const take = Math.min(rest.byteLength, VOICE_BATCH_BYTES - this.fill);
      this.batch.set(rest.subarray(0, take), this.fill);
      this.fill += take;
      rest = rest.subarray(take);
      if (this.fill === VOICE_BATCH_BYTES) {
        // Hand the full buffer over and start a fresh one: the queue keeps a
        // reference to what it was given, so it must never be written again.
        this.emit(this.batch.buffer);
        this.batch = new Uint8Array(VOICE_BATCH_BYTES);
        this.fill = 0;
      }
    }
  }

  /** Emit the partial batch, if any. */
  flush(): void {
    if (this.fill === 0) return;
    this.emit(this.batch.slice(0, this.fill).buffer);
    this.batch = new Uint8Array(VOICE_BATCH_BYTES);
    this.fill = 0;
  }

  /** Bytes pushed so far (flushed or not). */
  bytesSeen(): number {
    return this.totalBytes;
  }
}

/** A recording the actor is still feeding: a `PendingRecording` plus the frame intake. */
export interface StagedRecording extends PendingRecording {
  /** Stage one PCM frame. Ignored once the recording is sealed or discarded. */
  push: (frame: ArrayBuffer) => void;
  /** Whether any audio was staged — an empty recording is discarded, not sealed. */
  hasAudio: () => boolean;
}

/**
 * Start a recording: enqueue its `create` now (the queue does not wait for
 * the box) and return the handle the actor feeds frames into.
 */
export function startStagedRecording(opts: {
  recordingId: string;
  targetSessionId: string | null;
  sink: VoiceStagingSink;
}): StagedRecording {
  const { recordingId, targetSessionId, sink } = opts;
  sink.enqueueCreate(recordingId, { targetSessionId });
  const stager = new VoiceStager({ emit: (bytes) => sink.enqueueChunk(recordingId, bytes) });
  let settled: "open" | "sealed" | "discarded" = "open";

  const refuse = (attempted: "seal" | "discard"): void => {
    if (settled === (attempted === "seal" ? "sealed" : "discarded")) return;
    console.warn(`[voice-staging] Ignoring ${attempted} of recording ${recordingId}: already ${settled}`);
  };

  return {
    recordingId,
    push: (frame) => {
      // A worklet message can still land after the segment was handed off;
      // the recording is closed by then, so the frame is not part of it.
      if (settled === "open") stager.push(frame);
    },
    hasAudio: () => stager.bytesSeen() > 0,
    seal: (hq) => {
      if (settled !== "open") {
        refuse("seal");
        return;
      }
      settled = "sealed";
      stager.flush();
      sink.enqueueFinalize(recordingId, { hq });
    },
    discard: () => {
      if (settled !== "open") {
        refuse("discard");
        return;
      }
      settled = "discarded";
      sink.enqueueDiscard(recordingId);
    },
  };
}
