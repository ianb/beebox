/**
 * Canonical agent model IDs — the single source for literal model-ID strings
 * shared by engine-aware procedure tiers and the chat model picker. A model
 * version bump now changes one place.
 *
 * `opus` tracks the current Opus flagship — now Opus 5.5. Older selections
 * that still carry a retired ID (including Opus 5 and earlier `[1m]` context
 * variants Claude Code no longer exposes) are carried forward by
 * {@link normalizeModelId} at model admission and agent spawn boundaries, so
 * a persisted or procedure-card value keeps working.
 *
 * INTENTIONALLY dependency-free (only string literals, no imports) so it is
 * safe to bundle into the frontend — the frontend imports these values
 * directly rather than re-declaring them.
 */
export const MODEL_ID = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-1",
  luna: "gpt-6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-6-sol",
  astra: "gpt-6-astra",
  // GLM family (Z.ai's Anthropic-compatible endpoint) — rides the claude
  // engine; the endpoint/token come from the machine secret store per run.
  glm: "glm-5.3",
  glmFlash: "glm-5.3-flash",
} as const;

/**
 * Retired model IDs that older persisted chat selections or box procedure cards
 * may still carry, mapped to their current replacement. Older Opus IDs fold
 * into Opus 5.5; GPT-5.6 Luna and Sol fold into their GPT-6 replacements;
 * Fable 5 and its `[1m]` variant fold into Fable 5.1 (1M context is native to
 * the 5-tier — the `[1m]` suffix was a Claude Code convention that no longer
 * exists).
 */
const RETIRED_MODEL_IDS: Record<string, string> = {
  "claude-opus-5": MODEL_ID.opus,
  "claude-opus-4-8": MODEL_ID.opus,
  "claude-opus-4-8[1m]": MODEL_ID.opus,
  "claude-fable-5": MODEL_ID.fable,
  "claude-fable-5[1m]": MODEL_ID.fable,
  "gpt-5.6-luna": MODEL_ID.luna,
  "gpt-5.6-sol": MODEL_ID.sol,
};

/**
 * Translate a retired model ID to its current replacement, passing through any
 * live ID unchanged. Applied where stored configuration and chat choices enter
 * model policy, plus the final agent spawn boundary for raw procedure-card IDs,
 * so callers share one deprecation table.
 */
export function normalizeModelId(model: string): string {
  return RETIRED_MODEL_IDS[model] ?? model;
}

/**
 * Whether a model's non-empty `thinking` blocks are progress updates: short
 * lines written for the user before a tool call. Claude Code asks for
 * `thinking.display: "updates"` on these models, so their reasoning blocks
 * come back empty and any thinking text is an update, which the model can use
 * to say things the user needs to see. Earlier Claude models return
 * summarized reasoning in the same field, and other providers' reasoning is
 * not an update. The API hands back only a summary of each update.
 */
export function writesProgressUpdates(model: string | undefined): boolean {
  const match = /^claude-[a-z]+-(\d+)/.exec(model ?? "");
  return match !== null && Number(match[1]) >= 5;
}
