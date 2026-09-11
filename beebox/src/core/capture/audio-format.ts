import { z } from "zod";

export const CaptureAudioFormatSchema = z.enum(["webm-opus", "m4a-aac", "pcm-s16le-16k"]);
export type CaptureAudioFormat = z.infer<typeof CaptureAudioFormatSchema>;

export class StagingAudioFormatMismatchError extends Error {
  constructor() {
    super("Audio segment format does not match its first upload");
    this.name = "StagingAudioFormatMismatchError";
  }
}

export class M4ASegmentFileCountError extends Error {
  constructor() {
    super("M4A segment must contain exactly one complete file");
    this.name = "M4ASegmentFileCountError";
  }
}

export function isCaptureAudioFormatError(
  error: unknown,
): error is StagingAudioFormatMismatchError | M4ASegmentFileCountError {
  return error instanceof StagingAudioFormatMismatchError || error instanceof M4ASegmentFileCountError;
}

/**
 * `pcm-000001.raw`, `pcm-000002.raw`, … — the voice-recording chunk filename
 * (`docs/plans/resilient-voice-recording.md`, Track 1). 1-indexed, 6-digit
 * zero-padded, matching the finalize contiguity check
 * (`webapp/routes/capture-finalize-voice.ts`), which rebuilds this exact list
 * for `1..chunkCount` and compares it against the manifest's staged chunks.
 */
export function pcmChunkFilename(oneIndexedChunkNumber: number): string {
  return `pcm-${String(oneIndexedChunkNumber).padStart(6, "0")}.raw`;
}
