/**
 * Pure piece-planning for the HQ transcription job
 * (`docs/plans/resilient-voice-recording.md`, Track 1).
 *
 * A voice recording is staged as raw 16 kHz mono s16le PCM. The HQ job cuts it
 * into pieces of at most {@link HQ_PIECE_SECONDS} before wrapping each in a WAV
 * header (`shared/wav.ts`) and sending it to the transcription provider — a
 * 600 s recording sent whole was measured rejected by OpenRouter (400, see the
 * plan's incident section), and MAI-Transcribe-2's diarization ceiling is
 * "about 15 minutes". On a `piece-too-long` classification the job halves the
 * piece length via {@link nextPieceSeconds} down to {@link HQ_PIECE_FLOOR_SECONDS}.
 */

import { invariant } from "../../lib/invariant.js";

/** Bytes/second for 16 kHz mono 16-bit PCM: 16000 samples/s × 2 bytes/sample. */
export const PCM_BYTES_PER_SECOND = 32_000;

/** Default HQ piece length, in seconds — see the plan's incident measurement. */
export const HQ_PIECE_SECONDS = 300;

/** The shortest a piece may shrink to before a `piece-too-long` job gives up. */
export const HQ_PIECE_FLOOR_SECONDS = 150;

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
 * Halve `current` toward {@link HQ_PIECE_FLOOR_SECONDS}. Returns `null` once
 * halving would drop below the floor — the job's signal to give up and fail
 * `permanent` rather than retry with an ever-shrinking piece.
 */
export function nextPieceSeconds(current: number): number | null {
  const halved = current / 2;
  return halved < HQ_PIECE_FLOOR_SECONDS ? null : halved;
}
