/**
 * Canonical Claude model IDs — the single source for the literal model-ID
 * strings that were otherwise copy-pasted between the procedure engine's
 * short-name map (`procedure/engine-types.ts` MODEL_MAP) and the chat model
 * picker (`frontend/.../InteractiveChat-helpers.ts` MODEL_OPTIONS). A model
 * version bump now changes one place.
 *
 * INTENTIONALLY dependency-free (only string literals, no imports) so it is
 * safe to bundle into the frontend — the frontend imports these values
 * directly rather than re-declaring them.
 */
export const MODEL_ID = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus5: "claude-opus-5",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
  opus1m: "claude-opus-4-8[1m]",
  fable1m: "claude-fable-5[1m]",
} as const;
