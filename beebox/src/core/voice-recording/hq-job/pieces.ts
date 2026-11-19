/**
 * Pure piece-planning for the HQ transcription job
 * (`plan:resilient-voice-recording`, Track 1).
 *
 * A voice recording is staged as raw 16 kHz mono s16le PCM. The HQ job cuts it
 * into pieces of at most {@link hqPieceSeconds} for the service it is sent to,
 * before wrapping each in a WAV header (`shared/wav.ts`) and sending it. Each
 * service's limits live with its definition in `shared/transcription-services.ts`
 * (`plan:transcription-length-limits`). On a `piece-too-long` classification
 * the job shortens the piece via {@link shorterPieceSeconds} down to
 * {@link HQ_PIECE_FLOOR_SECONDS}.
 */

import { assertNever, invariant } from "../../../shared/invariant.js";
import { hqLengthLimits, type HqLengthLimit, type HqTranscriptionService } from "../../../shared/transcription-services.js";
import type { VoiceHqWord } from "../../capture/staging-schema.js";

/** Bytes/second for 16 kHz mono 16-bit PCM: 16000 samples/s × 2 bytes/sample. */
export const PCM_BYTES_PER_SECOND = 32_000;

/** A canonical 44-byte WAV header precedes each piece's PCM (`shared/wav.ts`). */
const WAV_HEADER_BYTES = 44;

/** The shortest a piece may shrink to before a `piece-too-long` job gives up. */
export const HQ_PIECE_FLOOR_SECONDS = 150;

/** One limit as whole seconds of 16 kHz mono WAV. */
function limitSeconds(limit: HqLengthLimit): number {
  switch (limit.kind) {
    case "seconds":
      return limit.maxSeconds;
    case "file-bytes":
      return Math.floor((limit.maxFileBytes - WAV_HEADER_BYTES) / PCM_BYTES_PER_SECOND);
    default:
      return assertNever(limit);
  }
}

/** The starting piece length for `service`: the smallest of its limits, in seconds. */
export function hqPieceSeconds(service: HqTranscriptionService): number {
  return Math.min(...hqLengthLimits(service).map(limitSeconds));
}

/** One piece's byte range within the recording's concatenated PCM, `endByte` exclusive. */
export interface BytePieceRange {
  startByte: number;
  endByte: number;
}

/**
 * Split `totalBytes` of 16 kHz mono s16le PCM into consecutive pieces of at
 * most `pieceSeconds` each, cut on sample (2-byte) boundaries so no piece ends
 * mid-sample. The final piece may be shorter. `totalBytes === 0` yields no
 * pieces.
 */
export function planPieces(totalBytes: number, pieceSeconds: number): BytePieceRange[] {
  invariant(totalBytes >= 0, "totalBytes must be non-negative");
  invariant(pieceSeconds > 0, "pieceSeconds must be positive");
  const rawPieceBytes = pieceSeconds * PCM_BYTES_PER_SECOND;
  // Round down to the nearest sample (2-byte) boundary so a cut never splits a sample.
  const pieceBytes = rawPieceBytes - (rawPieceBytes % 2);
  invariant(pieceBytes > 0, "pieceSeconds too small to produce a whole sample");

  const pieces: BytePieceRange[] = [];
  for (let start = 0; start < totalBytes; start += pieceBytes) {
    pieces.push({ startByte: start, endByte: Math.min(start + pieceBytes, totalBytes) });
  }
  return pieces;
}

/**
 * Halve `current` toward {@link HQ_PIECE_FLOOR_SECONDS}. A half below the floor
 * becomes the floor, so the floor is always tried once (225 → 150). Returns
 * `null` at the floor — the job's signal to give up and fail `permanent`
 * rather than retry with an ever-shrinking piece.
 */
export function nextPieceSeconds(current: number): number | null {
  if (current <= HQ_PIECE_FLOOR_SECONDS) return null;
  return Math.max(current / 2, HQ_PIECE_FLOOR_SECONDS);
}

/**
 * The piece length to retry with after a piece of `rejectedSeconds` was too
 * long at `current`. Halves until the result is shorter than the rejected
 * audio, so a retry never resends the same bytes: a 600 s recording rejected
 * at 3600 goes to 450, not 1800. `null` once the floor is passed.
 */
export function shorterPieceSeconds({ current, rejectedSeconds }: { current: number; rejectedSeconds: number }): number | null {
  let next = nextPieceSeconds(current);
  while (next !== null && next >= rejectedSeconds) next = nextPieceSeconds(next);
  return next;
}

/**
 * Every piece's words on the whole recording's timeline. A service times each
 * word from the start of the piece it was sent, so each piece's words shift by
 * that piece's start offset in the recording.
 */
export function joinPieceWords(pieces: readonly { startByte: number; words: readonly { word: string; start: number; end: number }[] }[]): VoiceHqWord[] {
  return pieces.flatMap(({ startByte, words }) => {
    const offset = startByte / PCM_BYTES_PER_SECOND;
    return words.map((w) => ({ start: offset + w.start, end: offset + w.end, text: w.word }));
  });
}
