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
 * **The mapping below is the boxholder's, made by listening**, not a heuristic.
 * They auditioned all 43 voices side by side and chose an equivalent for each
 * of ours (the `voice-mapping-openai-to-gemini` exhibit, 2026-09-06). It is not
 * a pitch match — several picks are four to six semitones from the nearest
 * candidate by measured pitch, and `nova` maps to the 29th-nearest — because
 * which voice a box should sound like is a judgement about character, and that
 * judgement is theirs. Do not "improve" these by pitch distance.
 */

import { BACKEND_DEFAULT_VOICE, GEMINI_VOICES, type TtsBackend } from "../../shared/tts-backends.js";
import { VOICE_MODELS } from "../../shared/voice-models.js";

export type VoiceChoice =
  /** The backend serves the requested voice under that name. */
  | { kind: "as-requested"; voice: string }
  /**
   * Translated through the boxholder's mapping. Not a degradation and not
   * warned about: they chose this equivalent deliberately.
   */
  | { kind: "mapped"; voice: string; requested: string }
  /**
   * No mapping and no such voice — the backend's default stands in. Carries
   * what was asked for so the caller can name it rather than logging
   * "voice ignored".
   */
  | { kind: "substituted"; voice: string; requested: string };

/**
 * Our voice names to their Gemini equivalents, chosen by ear
 * (see the module comment). Every OpenAI voice has one, so a personality card
 * keeps naming voices from `VOICE_MODELS` and no card migration is needed —
 * the translation happens at the seam.
 */
const OPENAI_TO_GEMINI: Record<string, string> = {
  onyx: "Enceladus",
  echo: "Umbriel",
  ash: "Algieba",
  fable: "Pulcherrima",
  cedar: "Orus",
  alloy: "Gacrux",
  nova: "Sulafat",
  shimmer: "Achernar",
  verse: "Rasalgethi",
  ballad: "Fenrir",
  coral: "Laomedeia",
  sage: "Leda",
  marin: "Vindemiatrix",
};

/** The mapping to reach one backend from a name belonging to another. */
const TRANSLATIONS: Partial<Record<TtsBackend, Record<string, string>>> = {
  gemini: OPENAI_TO_GEMINI,
};

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
  const translated = TRANSLATIONS[opts.backend]?.[requested];
  if (translated !== undefined) return { kind: "mapped", voice: translated, requested };
  return { kind: "substituted", voice: fallback, requested };
}
