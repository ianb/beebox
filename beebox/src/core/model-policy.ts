/**
 * The one ladder that answers "what model does this run use".
 *
 * Two levels resolve here and nowhere else: a per-chat choice (an explicit
 * model, or `follow` — the chat inherits) and the box's pinned model. Chat
 * reads it at subprocess spawn; the reactor reads it once per run. Keeping the
 * ladder in one place is what stops the two levels from drifting into two
 * slightly different fallback orders.
 */

import { isChatModelAllowed, isOpenRouterModelId, runsAddedModels, type AddedModel } from "../shared/chat-models.js";
import { hasProcedureTiers, modelTier, procedureTier, providerOf, resolveProcedureModel, type AgentEngine, type ProcedureModelName } from "../shared/agent-models.js";
import { normalizeModelId } from "../shared/model-ids.js";
import { loadAddedModels, loadAgentEngine, loadBoxModel, loadSmallModel } from "./box/config.js";
import { piModelMissing } from "./provider-env/openrouter-chat.js";

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
 * The tier a box runs when it has pinned nothing — Opus on Claude, Sol on Codex.
 *
 * Expressed as a tier rather than two ids because that is the mapping the rest
 * of the policy already uses, so the pair stays correct through a model-id bump
 * and cannot drift apart. Boxholder decision, 2026-09-14: *"I feel like we
 * should pick a default, using the harness default is hard to understand. I
 * generally think Sol and Opus should be the defaults."*
 */
const UNPINNED_DEFAULT_TIER = "strong";

/**
 * The box's default model as this engine can run it.
 *
 * An engine that offers the pinned model runs it exactly. An engine that does
 * not — because the box switched harness after the pin — gets the model at the
 * same tier, so the policy degrades to its nearest equivalent instead of
 * vanishing. Ids are normalized first: a retired id is carried forward by
 * `normalizeModelId`, and without that step it would fail the registry check
 * and read as "no policy".
 *
 * pi has no tiers to translate by, so on pi only an added OpenRouter pin runs
 * and any other pin reads as none (docs/plans/pi-box-engine.md, Track 2).
 *
 * `null` means the box pinned nothing — this function translates a pin, it does
 * not invent one. What an unpinned box actually runs is {@link boxDefaultModel},
 * one level up; the small-pass slot answers the same question differently
 * (see {@link resolveSmallModelForEngine}), which is why the default does not
 * live in here.
 */
export function resolveBoxModelForEngine(
  engine: AgentEngine,
  { pinned, added }: { pinned: string | null; added: readonly AddedModel[] },
): string | null {
  if (pinned === null) return null;
  const model = normalizeModelId(pinned);
  if (isChatModelAllowed(engine, { model, added })) return model;
  if (!hasProcedureTiers(engine)) return null;
  const tier = modelTier(model);
  if (tier === null) return null;
  return resolveProcedureModel({ engine, model: tier, provider: providerOf(model) });
}

/**
 * The model a chat that follows this box runs — the box's own answer, never the
 * harness's.
 *
 * An unpinned box used to resolve to `null`, meaning "whatever the SDK picks".
 * That left the box with no default it could name: the chat UI could not say
 * what a follower would run, and the model dial had nothing to compare against,
 * so it stayed blank on every unpinned box — which is most of them. Boxholder
 * decision, 2026-09-14: *"I feel like we should pick a default, using the
 * harness default is hard to understand."*
 *
 * A pin that exists but names no known model still yields `null`: a box saying
 * something the policy cannot read is not the same as a box saying nothing, and
 * quietly substituting a default there would hide a misconfiguration.
 *
 * pi is the exception to "always a default": it has no model of its own, and
 * any built-in one would spend without the owner adding it. An unpinned pi box
 * has no default, and its runs refuse until the owner chooses one.
 */
export function boxDefaultModel(
  engine: AgentEngine,
  { pinned, added }: { pinned: string | null; added: readonly AddedModel[] },
): string | null {
  if (pinned === null) return hasProcedureTiers(engine) ? resolveProcedureModel({ engine, model: UNPINNED_DEFAULT_TIER }) : null;
  return resolveBoxModelForEngine(engine, { pinned, added });
}

/**
 * Resolve a chat's effective model from its own choice and the box's pin.
 *
 * An explicit choice wins, unless it belongs to the other engine — a chat that
 * picked a Claude model on a box now running Codex falls through to the box
 * policy rather than to nothing.
 *
 * One exception keeps a pick the box no longer allows: an OpenRouter model the
 * owner removed from admin, on an engine that runs added models (claude, pi). Falling through would quietly change who answers
 * the chat, so the pick survives here and the spawn refuses it with the fix
 * (boxholder, 2026-09-19).
 */
export function resolveEffectiveModel(
  { engine, pinned, added }: { engine: AgentEngine; pinned: string | null; added: readonly AddedModel[] },
  choice: ChatModelChoice,
): ResolvedModel {
  if (choice.kind === "explicit") {
    const explicit = normalizeModelId(choice.model);
    if (isChatModelAllowed(engine, { model: explicit, added })) return { model: explicit, source: "explicit" };
    if (runsAddedModels(engine) && isOpenRouterModelId(explicit)) return { model: explicit, source: "explicit" };
  }
  const fromPolicy = boxDefaultModel(engine, { pinned, added });
  if (fromPolicy !== null) return { model: fromPolicy, source: "default" };
  return { model: null, source: "none" };
}

/**
 * Describe the model a live subprocess is running — the one a status read must
 * report, rather than the one a restart would pick.
 *
 * A chat whose own pick is what is running is `explicit`; anything else it is
 * running came from the box default at the moment it started cold, even if the
 * default has since changed.
 */
export function liveModelState(
  { explicit, resolved }: { explicit: string | null; resolved: string | null },
): ResolvedModel {
  if (resolved === null) return { model: null, source: "none" };
  return { model: resolved, source: resolved === explicit ? "explicit" : "default" };
}

/**
 * The box's pinned model as the box's own engine can run it, or null when no
 * policy is set. The form agent runs outside chat want: one read, one answer,
 * resolved once at the top of a run so nothing changes model midway.
 */
export async function loadEffectiveBoxModel(boxRoot: string): Promise<string | null> {
  const engine = await loadAgentEngine(boxRoot);
  return resolveBoxModelForEngine(engine, { pinned: await loadBoxModel(boxRoot), added: await loadAddedModels(boxRoot) });
}

/**
 * The model the box's cheap structured passes run on — chat review, retro
 * observation, triage.
 *
 * On claude and codex this never returns null: a small pass always has an
 * answer, and the answer defaults to the `efficient` tier for whichever engine
 * is running it. These passes used to name a provider-shaped nickname
 * (`"haiku"`) which the Codex delegate forwarded to the Codex SDK verbatim
 * (`issues/closed/bugs/2026-08-25-haiku-nickname-reaches-codex-verbatim.md`). Nothing
 * here can produce a name an engine does not know.
 *
 * An OpenRouter default has no efficient tier, so an unpinned small slot on
 * such a box takes the default itself: background work follows the model the
 * owner chose instead of quietly needing a Claude login (boxholder,
 * 2026-10-15).
 *
 * pi has no efficient tier either. A pinned small model runs only if it is
 * added, else the box default; with no default the answer is `null`, which the
 * loaders below turn into the setup refusal. A first-party `smallModel` left
 * from the box's claude days is a pin pi cannot run, so it reads as none.
 */
export function resolveSmallModelForEngine(params: {
  engine: AgentEngine;
  pinned: string | null;
  added: readonly AddedModel[];
  /** The box's effective default model — picks the efficient tier's provider when `pinned` is null. */
  boxDefault: string | null;
}): string | null {
  const chosen = resolveBoxModelForEngine(params.engine, { pinned: params.pinned, added: params.added });
  if (chosen !== null) return chosen;
  if (!hasProcedureTiers(params.engine)) return params.boxDefault;
  if (params.boxDefault !== null && providerOf(params.boxDefault) === "openrouter") return params.boxDefault;
  // No pinned small model: take the engine's efficient tier on the provider
  // the box's own default runs, so a GLM-defaulted box's cheap passes stay GLM
  // instead of silently billing first-party Haiku.
  return resolveProcedureModel({
    engine: params.engine,
    model: "efficient",
    ...(params.boxDefault === null ? {} : { provider: providerOf(params.boxDefault) }),
  });
}

/**
 * The concrete model a procedure tier runs on this box.
 *
 * A first-party, GLM, or Codex box reads the tier table on its default's
 * provider. An OpenRouter default has no tier column, so the box's two slots
 * stand in: `efficient` and `balanced` take the small model, `strong` and
 * `strongest` the default (boxholder, 2026-10-15). `small` is the resolved
 * small model, which is itself the default when the slot is unpinned.
 *
 * pi always uses the two slots, having no tier table. Either slot may be
 * `null` there (no default chosen), and so may the answer.
 */
export function resolveTierModel(params: {
  engine: AgentEngine;
  name: ProcedureModelName;
  boxDefault: string | null;
  small: string | null;
}): string | null {
  const provider = providerOf(params.boxDefault ?? "");
  const slots = !hasProcedureTiers(params.engine)
    || (params.engine === "claude" && params.boxDefault !== null && provider === "openrouter");
  if (slots) {
    const tier = procedureTier(params.name);
    return tier === "efficient" || tier === "balanced" ? params.small : params.boxDefault;
  }
  return resolveProcedureModel({ engine: params.engine, model: params.name, provider });
}

async function loadSmallSlot(boxRoot: string): Promise<string | null> {
  const engine = await loadAgentEngine(boxRoot);
  const boxDefault = await loadEffectiveBoxModel(boxRoot);
  return resolveSmallModelForEngine({ engine, pinned: await loadSmallModel(boxRoot), added: await loadAddedModels(boxRoot), boxDefault });
}

/**
 * The box's small-pass model for its own engine. One read, one concrete id. A
 * pi box with no model for the slot refuses with the OpenRouter setup error.
 */
export async function loadEffectiveSmallModel(boxRoot: string): Promise<string> {
  const model = await loadSmallSlot(boxRoot);
  if (model === null) throw piModelMissing();
  return model;
}

/**
 * Resolve procedure tiers for one run. The box config is read once, so every
 * step of a run sees the same policy. A tier with no model (a pi box with no
 * default) refuses when it is asked for, not before.
 */
export async function loadTierResolver(boxRoot: string): Promise<(name: ProcedureModelName) => string> {
  const engine = await loadAgentEngine(boxRoot);
  const boxDefault = await loadEffectiveBoxModel(boxRoot);
  const small = await loadSmallSlot(boxRoot);
  return (name) => {
    const model = resolveTierModel({ engine, name, boxDefault, small });
    if (model === null) throw piModelMissing();
    return model;
  };
}
