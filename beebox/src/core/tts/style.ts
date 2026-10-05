/**
 * Where a backend's style direction goes — the pure decision at the centre of
 * multi-backend TTS (`docs/plans/tts-backend-selection.md`, Track 3).
 *
 * The boxholder writes style direction once, on the personality card's
 * `speaking-voice.instructions`. Every backend takes it somewhere different,
 * and one route takes it nowhere at all. Getting that wrong is inaudible to us
 * and audible to them, so the decision is a pure function the cheapest test
 * tier can reach (principle 10) rather than a branch inside an HTTP call.
 *
 * A discriminated union rather than an optional string, so adding a backend
 * cannot compile until someone decides what happens to the direction
 * (principle 2, exhaustiveness).
 */

import type { ModelRoute } from "../openrouter.js";
import type { TtsBackend } from "../../shared/tts-backends.js";

export type StyleDelivery =
  /** Nothing to place: the text is spoken as written and nothing is lost. */
  | { kind: "none" }
  /**
   * The route has a dedicated parameter — OpenAI's `instructions`, Gemini's
   * `speech_metadata.style` annotation.
   */
  | { kind: "field"; instructions: string }
  /**
   * The route has no style mechanism. Carries the text that will not be
   * honored so the caller can name what was lost rather than logging
   * "instructions ignored".
   */
  | { kind: "unsupported"; dropped: string };

/**
 * Whether a route can act on style direction at all — also
 * `TtsService.stylable`, so the service and the delivery cannot disagree.
 *
 * Gemini 3.8 over OpenRouter cannot take direction anywhere. The model treats
 * its input as a verbatim transcript, so the `<direction>: "<text>"` prefix
 * that 3.1 honored is now read aloud, and OpenRouter's speech request ignores
 * every style-shaped field. Measured 2026-10-04: a transcript of the prefixed
 * render began "Fast and concise, but with a friendly lilting tone…", and
 * "speak extremely slowly" versus "extremely fast" sent as `instructions`,
 * `style`, or `prompt` changed the clip length by under a second, where the
 * same pair on the direct route gave 13.6 s versus 4.2 s.
 */
export function routeIsStylable(backend: TtsBackend, via: ModelRoute["via"]): boolean {
  switch (backend) {
    case "openai":
      return true;
    case "gemini":
      return via === "direct";
  }
}

export function deliverStyle(opts: {
  backend: TtsBackend;
  via: ModelRoute["via"];
  instructions: string | undefined;
}): StyleDelivery {
  const instructions = opts.instructions?.trim();
  // No direction to place is not the same as a route that cannot take one:
  // nothing is reported as dropped.
  if (instructions === undefined || instructions === "") return { kind: "none" };
  return routeIsStylable(opts.backend, opts.via)
    ? { kind: "field", instructions }
    : { kind: "unsupported", dropped: instructions };
}
