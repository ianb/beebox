/**
 * Is a chat running something stronger, weaker, or level with the box default —
 * and is it even on the box's own harness?
 *
 * The chip shows a mark for the answer, so the boxholder can see at a glance
 * that a conversation is off their usual model — burning the expensive one on
 * small talk, or quietly running dumb after a cost-saving switch
 * (`docs/implemented-plans/model-engine-policy.md`).
 *
 * Split from `SessionChip.tsx` so the comparison can be tested without
 * rendering a menu.
 */

import { modelTier, TIER_RANK } from "@shared/agent-models.js";

/**
 * `"same"` rather than nothing when the chat is at the box's tier — the chip
 * shows a mark for it, so the mark's ABSENCE means one thing (the comparison
 * could not be made) instead of four. An indicator that vanishes for "nothing
 * to report" is indistinguishable from one that is broken, which is how this
 * one read: *"that up/down model indicator is good too, but doesn't seem to
 * display consistently"* (boxholder, 2026-09-14).
 *
 * `null` is kept for the cases where the answer is genuinely unknown — nothing
 * pinned yet, status not loaded, or a model id no engine claims. Those must not
 * borrow `"same"`: a chat running an unrecognized model is not known to be at
 * the default, and saying so would be the confident-wrong answer.
 *
 * Two different models of one tier report `"same"`. The comparison has always
 * been about tier rather than identity — that is what makes it survive a
 * model-id bump and mean something across engines.
 */
export function modelDrift({ model, boxDefault }: { model: string | null; boxDefault: string | null }): "above" | "below" | "same" | null {
  if (model === null || boxDefault === null) return null;
  if (model === boxDefault) return "same";
  const tier = modelTier(model);
  const defaultTier = modelTier(boxDefault);
  if (tier === null || defaultTier === null) return null;
  if (TIER_RANK[tier] === TIER_RANK[defaultTier]) return "same";
  return TIER_RANK[tier] > TIER_RANK[defaultTier] ? "above" : "below";
}

/**
 * Is this chat running on a different harness than the box's own?
 *
 * Separate from tier: a Codex chat on a Claude box is not stronger or weaker,
 * it is somewhere else, and the tier comparison deliberately flattens that
 * (Sol and Opus are both `strong`). The chip marks it with its own glyph.
 */
export function engineDrift({ engine, boxEngine }: { engine: string | null; boxEngine: string | null }): boolean {
  return engine !== null && boxEngine !== null && engine !== boxEngine;
}

