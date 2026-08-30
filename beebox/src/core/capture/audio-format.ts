import { z } from "zod";

export const CaptureAudioFormatSchema = z.enum(["webm-opus", "m4a-aac"]);
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
