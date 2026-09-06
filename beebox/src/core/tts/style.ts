/**
 * Where a backend's style direction goes — the pure decision at the centre of
 * multi-backend TTS (`docs/plans/tts-backend-selection.md`, Track 3).
 *
 * The boxholder writes style direction once, on the personality card's
 * `speaking-voice.instructions`. Every backend takes it somewhere different,
 * and one takes it nowhere at all. Getting that wrong is inaudible to us and
 * audible to them, so the decision is a pure function the cheapest test tier
 * can reach (principle 10) rather than a branch inside an HTTP call.
 *
 * A discriminated union rather than an optional string, so adding a backend
 * cannot compile until someone decides what happens to the direction
 * (principle 2, exhaustiveness).
 */

import type { TtsBackend } from "../../shared/tts-backends.js";

export type StyleDelivery =
  /** The backend has a dedicated parameter — OpenAI's `instructions`. */
  | { kind: "field"; instructions: string }
  /** The direction rides inside the spoken input, ahead of the text. */
  | { kind: "prefix"; input: string }
  /**
   * The backend has no style mechanism. Carries the text that will not be
   * honored so the caller can name what was lost rather than logging
   * "instructions ignored".
   */
  | { kind: "unsupported"; dropped: string };

/**
 * Gemini's documented form is `<direction>: "<text>"`
 * (ai.google.dev/gemini-api/docs/speech-generation), and the punctuation is
 * load-bearing rather than stylistic.
 *
 * Measured 2026-09-06: a direction ending in a PERIOD followed by a short text
 * makes the model return HTTP 200 with a zero-length body — 0 of 6 renders, and
 * 0 of 10 on a second input, with retries and a different voice both making no
 * difference. The colon form renders 6 of 6 at every length tested. The prefix
 * is built here, once, precisely so no caller can reintroduce that.
 */
function geminiPrefix(instructions: string, text: string): string {
  const direction = instructions.trim().replace(/[\s.:]+$/, "");
  return `${direction}: "${text}"`;
}

export function deliverStyle(opts: {
  backend: TtsBackend;
  text: string;
  instructions: string | undefined;
}): StyleDelivery {
  const instructions = opts.instructions?.trim();
  // No direction to place is not the same as a backend that cannot take one:
  // the text is spoken as written, and nothing is reported as dropped.
  if (instructions === undefined || instructions === "") {
    return { kind: "prefix", input: opts.text };
  }
  switch (opts.backend) {
    case "openai":
      return { kind: "field", instructions };
    case "gemini":
      return { kind: "prefix", input: geminiPrefix(instructions, opts.text) };
  }
}
