/**
 * The speaking-voice model vocabulary — the closed set of TTS voice names a
 * personality card may pick. Extracted to `shared/` (from
 * `schemas/personality-fields.ts`) so the frontend speech-parsing helpers can
 * import the runtime array as a bundler-safe value without pulling the
 * personality schema/compile graph into the client bundle.
 * `schemas/personality-fields.ts` re-exports both, so the schema and its
 * downstream importers are unaffected.
 */
export const VOICE_MODELS = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse",
] as const;
export type VoiceModel = typeof VOICE_MODELS[number];
