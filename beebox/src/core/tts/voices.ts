/**
 * Which voice a backend can actually use — the second half of the translation
 * problem `style.ts` solves for tone.
 *
 * A personality card names a voice from `VOICE_MODELS` (alloy…verse), and
 * **zero of those names exist on Gemini**. Sending one is not a graceful
 * default but an HTTP 400 from the provider, so a box that picks the Gemini
 * backend loses speech entirely unless the voice is translated here.
 *
 * Substitution is reported rather than performed quietly: the boxholder chose
 * that voice, and a different one coming out of the speaker with no explanation
 * is the invisible degradation principle 4 forbids.
 *
 * **This is deliberately mechanical, not semantic.** Mapping `onyx` to whichever
 * Gemini voice sounds most like it is a judgement call about how the box should
 * sound, and belongs to the boxholder — see the voices subplan. Until then a
 * voice the backend cannot serve falls back to that backend's default and says
 * so, which is honest and predictable rather than clever.
 */

import { BACKEND_DEFAULT_VOICE, GEMINI_VOICES, type TtsBackend } from "../../shared/tts-backends.js";
import { VOICE_MODELS } from "../../shared/voice-models.js";

export type VoiceChoice =
  /** The backend serves the requested voice. */
  | { kind: "as-requested"; voice: string }
  /**
   * The backend has no such voice. Carries what was asked for so the caller can
   * name it rather than logging "voice ignored".
   */
  | { kind: "substituted"; voice: string; requested: string };

const BACKEND_VOICES: Record<TtsBackend, ReadonlySet<string>> = {
  openai: new Set<string>(VOICE_MODELS),
  gemini: new Set<string>(GEMINI_VOICES),
};

export function resolveVoice(opts: { backend: TtsBackend; requested: string | undefined }): VoiceChoice {
  const fallback = BACKEND_DEFAULT_VOICE[opts.backend];
  const requested = opts.requested?.trim();
  // Nothing asked for is not a substitution — there is no choice to report as
  // overridden.
  if (requested === undefined || requested === "") return { kind: "as-requested", voice: fallback };
  if (BACKEND_VOICES[opts.backend].has(requested)) return { kind: "as-requested", voice: requested };
  return { kind: "substituted", voice: fallback, requested };
}
