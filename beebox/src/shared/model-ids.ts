/**
 * Canonical agent model IDs — the single source for literal model-ID strings
 * shared by engine-aware procedure tiers and the chat model picker. A model
 * version bump now changes one place.
 *
 * `opus` tracks the current Opus flagship — now Opus 5. Older selections that
 * still carry a retired ID (Opus 4.8, or the `[1m]` context variants Claude
 * Code no longer exposes) are carried forward by {@link normalizeModelId} at
 * the agent spawn boundary, so a persisted or procedure-card value keeps working.
 *
 * INTENTIONALLY dependency-free (only string literals, no imports) so it is
 * safe to bundle into the frontend — the frontend imports these values
 * directly rather than re-declaring them.
 */
export const MODEL_ID = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  fable: "claude-fable-5",
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
} as const;

/**
 * Retired model IDs that older persisted chat selections or box procedure cards
 * may still carry, mapped to their current replacement. Opus 4.8 (and its `[1m]`
 * variant) fold into Opus 5; the Fable `[1m]` variant folds into plain Fable 5
 * (1M context is native to the 5-tier — the `[1m]` suffix was a Claude Code
 * convention that no longer exists).
 */
const RETIRED_MODEL_IDS: Record<string, string> = {
  "claude-opus-4-8": MODEL_ID.opus,
  "claude-opus-4-8[1m]": MODEL_ID.opus,
  "claude-fable-5[1m]": MODEL_ID.fable,
};

/**
 * Translate a retired model ID to its current replacement, passing through any
 * live ID unchanged. Applied at the single agent spawn boundary (`agent/run.ts`)
 * so every path — chat picker, procedure short-name, raw procedure-card ID —
 * resolves forward without each caller knowing the deprecation table.
 */
export function normalizeModelId(model: string): string {
  return RETIRED_MODEL_IDS[model] ?? model;
}
