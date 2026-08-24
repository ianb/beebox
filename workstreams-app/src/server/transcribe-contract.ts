// The transcription contract: what the route accepts, what it refuses, and how
// it names each refusal.
//
// SPLIT FROM THE IMPLEMENTATION on purpose. The frontend tsconfig includes the
// tRPC router for its types, which reaches this file — so anything here must
// typecheck under DOM libs. The OpenAI call (Blob, fetch, Buffer) lives in
// transcribe-openai.ts, which only main.ts imports.

import { z } from "zod";

/** How much audio one comment may carry. See the body-limit note below. */
export const MAX_AUDIO_BYTES = 700_000;

export const transcribeInputSchema = z.object({
  /** Base64 audio. Raw POST paths are refused by the router, so it rides tRPC. */
  audio: z.string().min(1),
  /** Container/codec hint for the transcription service, e.g. "audio/webm". */
  mimeType: z.string().max(120).default("audio/webm"),
});

/**
 * Three distinct failures, three classes — the preset requires a dedicated
 * class per message rather than a literal, and it is right to here: "no key
 * configured", "the service refused", and "the service answered something we
 * did not recognize" want different responses from the person reading them.
 */
export class TranscriptionNotConfiguredError extends Error {
  constructor() {
    super("CALLBACK_OPENAI_API_KEY is not set, so spoken comments cannot be transcribed — type it instead.");
    this.name = "TranscriptionNotConfiguredError";
  }
}

export class TranscriptionRefusedError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`Transcription failed with status ${String(status)}. The recording is still here — retry, or type it.`);
    this.name = "TranscriptionRefusedError";
  }
}

export class TranscriptionShapeError extends Error {
  constructor() {
    super("The transcription service answered in a shape this app does not recognize.");
    this.name = "TranscriptionShapeError";
  }
}

