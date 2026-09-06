/**
 * The text-to-speech backend vocabulary — the closed set of engines a box may
 * speak with, and the one place the names are written.
 *
 * In `shared/` for the reason `transcription-services.ts` is: the frontend
 * picker, the tRPC input schema, and the engine must read the same set. That
 * file's own history is the argument — the same list hand-copied into three
 * places drifted the moment a service was added.
 *
 * Vocabulary only. No engine imports, so the picker can use the runtime array
 * without pulling the TTS services into the client bundle.
 */

/**
 * - `openai` — `gpt-4o-mini-tts` on OpenAI's own speech endpoint. The default,
 *   and the only backend with a dedicated field for style direction.
 * - `gemini` — `gemini-3.1-flash-tts-preview` through OpenRouter. Takes style
 *   direction too, but inside the prompt (`core/tts/style.ts`).
 */
export const TTS_BACKENDS = ["openai", "gemini"] as const;
export type TtsBackend = (typeof TTS_BACKENDS)[number];

/**
 * Gemini's own voice names. Zero of them overlap `VOICE_MODELS`, so a voice a
 * personality card names is never usable here — sending one is an HTTP 400
 * from the provider, not a graceful default (measured 2026-09-06:
 * `marin` and `alloy` both 400).
 *
 * Kept as our own list rather than read from OpenRouter's `supported_voices`,
 * which is not exhaustive: `nova` is absent from it and renders anyway. A
 * catalog that accepts values it does not list cannot be used to validate.
 */
export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

/** What each backend answers to when nothing usable was asked for. */
export const BACKEND_DEFAULT_VOICE: Record<TtsBackend, string> = {
  openai: "marin",
  gemini: "Zephyr",
};

/**
 * The voice used when neither the personality card nor the request names one.
 * Was written three different ways across the stack before this existed
 * (`alloy` in the service, `marin` in the route and the client); `marin` is
 * what the two live paths actually used, so it is what a box already hears.
 */
export const DEFAULT_VOICE = "marin";

/**
 * The style direction used when a box's personality card sets none. Also
 * previously triplicated — service, route, and frontend client each held their
 * own copy of this string.
 */
export const DEFAULT_TTS_INSTRUCTIONS = "Fast and concise, but with a friendly lilting tone.";
