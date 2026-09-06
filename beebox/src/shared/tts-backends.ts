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
