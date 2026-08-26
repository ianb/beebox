/**
 * The one ladder that answers "what model does this run use".
 *
 * Two levels resolve here and nowhere else: a per-chat choice (an explicit
 * model, or `follow` — the chat inherits) and the box's pinned model. Chat
 * reads it at subprocess spawn; the reactor reads it once per run. Keeping the
 * ladder in one place is what stops the two levels from drifting into two
 * slightly different fallback orders.
 */

import { isChatModelAllowed } from "../shared/chat-models.js";
import { modelTier, resolveProcedureModel, type AgentEngine } from "../shared/agent-models.js";
import { normalizeModelId } from "../shared/model-ids.js";
import { loadAgentEngine, loadBoxModel } from "./box/config.js";

/** A chat's own model state: an explicit pick, or "whatever the box says". */
export type ChatModelChoice =
  | { kind: "explicit"; model: string }
  | { kind: "follow" };

/** Where a resolved model came from. `none` means the harness's own default. */
export type ModelSource = "explicit" | "default" | "none";

export interface ResolvedModel {
  model: string | null;
  source: ModelSource;
}

/**
 * The box's pinned model as this engine can run it.
 *
 * An engine that offers the pinned model runs it exactly. An engine that does
 * not — because the box switched harness after the pin — gets the model at the
 * same tier, so the policy degrades to its nearest equivalent instead of
 * vanishing. Ids are normalized first: a retired id is carried forward by
 * `normalizeModelId`, and without that step it would fail the registry check
 * and read as "no policy".
 */
export function resolveBoxModelForEngine(engine: AgentEngine, pinned: string | null): string | null {
  if (pinned === null) return null;
  const model = normalizeModelId(pinned);
  if (isChatModelAllowed(engine, model)) return model;
  const tier = modelTier(model);
  if (tier === null) return null;
  return resolveProcedureModel(engine, tier);
}

/**
 * Resolve a chat's effective model from its own choice and the box's pin.
 *
 * An explicit choice wins, unless it belongs to the other engine — a chat that
 * picked a Claude model on a box now running Codex falls through to the box
 * policy rather than to nothing.
 */
export function resolveEffectiveModel(
  { engine, pinned }: { engine: AgentEngine; pinned: string | null },
  choice: ChatModelChoice,
): ResolvedModel {
  if (choice.kind === "explicit") {
    const explicit = normalizeModelId(choice.model);
    if (isChatModelAllowed(engine, explicit)) return { model: explicit, source: "explicit" };
  }
  const fromPolicy = resolveBoxModelForEngine(engine, pinned);
  if (fromPolicy !== null) return { model: fromPolicy, source: "default" };
  return { model: null, source: "none" };
}

/**
 * The box's pinned model as the box's own engine can run it, or null when no
 * policy is set. The form agent runs outside chat want: one read, one answer,
 * resolved once at the top of a run so nothing changes model midway.
 */
export async function loadEffectiveBoxModel(boxRoot: string): Promise<string | null> {
  const engine = await loadAgentEngine(boxRoot);
  return resolveBoxModelForEngine(engine, await loadBoxModel(boxRoot));
}
