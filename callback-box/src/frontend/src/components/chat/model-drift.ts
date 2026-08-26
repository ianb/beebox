/**
 * Is a chat running something stronger or weaker than the box default?
 *
 * The chip shows a mark for the answer, so the boxholder can see at a glance
 * that a conversation is off their usual model — burning the expensive one on
 * small talk, or quietly running dumb after a cost-saving switch
 * (`docs/plans/model-engine-policy.md`).
 *
 * Split from `SessionChip.tsx` so the comparison can be tested without
 * rendering a menu.
 */

import { modelTier, TIER_RANK } from "@shared/agent-models.js";

/**
 * `null` — and so no mark — whenever the comparison would be meaningless or
 * uninteresting: nothing pinned, an unknown model, or the same tier (two
 * models of one tier are a sideways move, not a smarter/dumber one).
 */
export function modelDrift({ model, boxDefault }: { model: string | null; boxDefault: string | null }): "above" | "below" | null {
  if (model === null || boxDefault === null || model === boxDefault) return null;
  const tier = modelTier(model);
  const defaultTier = modelTier(boxDefault);
  if (tier === null || defaultTier === null || TIER_RANK[tier] === TIER_RANK[defaultTier]) return null;
  return TIER_RANK[tier] > TIER_RANK[defaultTier] ? "above" : "below";
}

