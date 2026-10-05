/**
 * Where a backend's style direction goes — the pure decision at the centre of
 * multi-backend TTS (`docs/plans/tts-backend-selection.md`, Track 3).
 *
 * The boxholder writes style direction once, on the personality card's
 * `speaking-voice.instructions`. Every backend takes it somewhere different,
 * and a backend might take it nowhere at all. Getting that wrong is inaudible
 * to us and audible to them, so the decision is a pure function the cheapest test
 * tier can reach (principle 10) rather than a branch inside an HTTP call.
 *
 * A discriminated union rather than an optional string, so adding a backend
 * cannot compile until someone decides what happens to the direction
 * (principle 2, exhaustiveness).
 */

import type { TtsBackend } from "../../shared/tts-backends.js";

export type StyleDelivery =
  /** Nothing to place: the text is spoken as written and nothing is lost. */
  | { kind: "none" }
  /**
   * The backend has a dedicated parameter — OpenAI's `instructions`, Gemini's
   * `speech_metadata.style` annotation.
   */
  | { kind: "field"; instructions: string }
  /**
   * The backend has no style mechanism. Carries the text that will not be
   * honored so the caller can name what was lost rather than logging
   * "instructions ignored".
   */
  | { kind: "unsupported"; dropped: string };

/**
 * Both backends take direction in a field of its own: OpenAI's
 * `instructions`, Gemini 3.8's `speech_metadata` annotation. Never inside the
 * spoken text — 3.8 reads that aloud, which is why Gemini speech has no
 * OpenRouter route (`resolve.ts`).
 */
export function deliverStyle(opts: { backend: TtsBackend; instructions: string | undefined }): StyleDelivery {
  const instructions = opts.instructions?.trim();
  // No direction to place is not the same as a backend that cannot take one:
  // nothing is reported as dropped.
  if (instructions === undefined || instructions === "") return { kind: "none" };
  switch (opts.backend) {
    case "openai":
    case "gemini":
      return { kind: "field", instructions };
  }
}
