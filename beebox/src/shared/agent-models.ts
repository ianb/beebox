import { MODEL_ID } from "./model-ids.js";
import { invariant } from "../lib/invariant.js";

/** Agent-engine names shared by box config, chat, and procedure model policy. */
export const AGENT_ENGINES = ["claude", "codex"] as const;
export type AgentEngine = (typeof AGENT_ENGINES)[number];

/**
 * Portable procedure tiers, followed by the provider-shaped legacy aliases
 * accepted by existing box cards. New procedure cards should use the tiers.
 */
export const PROCEDURE_MODEL_NAMES = [
  "efficient",
  "balanced",
  "strong",
  "strongest",
  "haiku",
  "sonnet",
  "opus",
  "fable",
] as const;
export type ProcedureModelName = (typeof PROCEDURE_MODEL_NAMES)[number];
export type ProcedureModelTier = "efficient" | "balanced" | "strong" | "strongest";

const LEGACY_TIER: Record<ProcedureModelName, ProcedureModelTier> = {
  efficient: "efficient",
  balanced: "balanced",
  strong: "strong",
  strongest: "strongest",
  haiku: "efficient",
  sonnet: "balanced",
  opus: "strong",
  fable: "strongest",
};

/** The provider a concrete model id runs on — GLM and OpenRouter ids ride the claude engine. */
export type ModelProvider = "anthropic" | "glm" | "openai" | "openrouter";

/** The column {@link resolveProcedureModel} uses when a call site has no
 * better answer — each engine's own first-party provider. */
const ENGINE_DEFAULT_PROVIDER: Record<AgentEngine, ModelProvider> = {
  claude: "anthropic",
  codex: "openai",
};

/**
 * Which provider a concrete model id runs on. Prefix rules match
 * `MODEL_ID`'s families; an id with a slash is OpenRouter's `author/slug`
 * shape, which no other family uses. Unknown ids read as the claude engine's
 * default, whose resolver call sites are engine-scoped.
 *
 * `openrouter` has no {@link PROCEDURE_MODELS} column on purpose: an added
 * model has no tier, so a tiered step on an OpenRouter-defaulted box falls
 * back to first-party (boxholder, 2026-09-19).
 */
export function providerOf(model: string): ModelProvider {
  if (model.includes("/")) return "openrouter";
  if (model.startsWith("glm-")) return "glm";
  if (model.startsWith("gpt-")) return "openai";
  return "anthropic";
}

/**
 * True when a run on this model leaves first-party Anthropic while riding the
 * claude engine — GLM or an owner-added OpenRouter model. Those runs carry
 * their own endpoint and key, and the SDK's Claude-priced cost figure is wrong
 * for them.
 */
export function isThirdPartyModel(model: string | null | undefined): model is string {
  if (model === null || model === undefined) return false;
  const provider = providerOf(model);
  return provider === "glm" || provider === "openrouter";
}

/**
 * Provider-relative policy, not a claim that models on the same row have equal
 * capability. Each engine has one column per provider it can run: claude runs
 * first-party Anthropic or GLM (Z.ai's Anthropic-compatible endpoint), codex
 * runs OpenAI. GLM's two ids cover all four tiers — flash takes the two lower
 * tiers, glm the two higher (boxholder, 2026-09-15: overlap is the intended
 * design; there is no third GLM model to buy tiers with).
 */
const PROCEDURE_MODELS: Record<AgentEngine, Partial<Record<ModelProvider, Record<ProcedureModelTier, string>>>> = {
  claude: {
    anthropic: {
      efficient: MODEL_ID.haiku,
      balanced: MODEL_ID.sonnet,
      strong: MODEL_ID.opus,
      strongest: MODEL_ID.fable,
    },
    glm: {
      efficient: MODEL_ID.glmFlash,
      balanced: MODEL_ID.glmFlash,
      strong: MODEL_ID.glm,
      strongest: MODEL_ID.glm,
    },
  },
  codex: {
    openai: {
      efficient: MODEL_ID.luna,
      balanced: MODEL_ID.terra,
      strong: MODEL_ID.sol,
      strongest: MODEL_ID.astra,
    },
  },
};

/** Narrow an untrusted string to a portable tier (or legacy alias). */
export function isProcedureModelName(value: string): value is ProcedureModelName {
  const names: readonly string[] = PROCEDURE_MODEL_NAMES;
  return names.includes(value);
}

/**
 * Resolve a portable procedure tier (or legacy alias) for one native engine.
 *
 * `provider` picks the engine's tier column — first-party vs GLM on claude.
 * It defaults to the engine's own provider, and an engine that cannot run the
 * requested provider falls back to that same default: a glm pin on a codex box
 * degrades to the codex tier table rather than vanishing.
 */
export function resolveProcedureModel(params: {
  engine: AgentEngine;
  model: ProcedureModelName;
  /** Tier column — first-party vs GLM on claude. Missing means the engine's own provider. */
  provider?: ModelProvider;
}): string {
  const columns = PROCEDURE_MODELS[params.engine];
  const own = ENGINE_DEFAULT_PROVIDER[params.engine];
  const fallback = columns[own];
  invariant(fallback !== undefined, `no default tier table for engine ${params.engine}`);
  return (columns[params.provider ?? own] ?? fallback)[LEGACY_TIER[params.model]];
}

/**
 * Tier of a concrete model id — the reverse of {@link PROCEDURE_MODELS}, used to
 * translate a box's pinned model for an engine that cannot run it and to rank
 * one model against another (smarter/dumber).
 *
 * The forward table is one-to-one per engine, so the reverse is exact: each
 * id maps to one tier even where two ids of different providers share a tier.
 */
const MODEL_TIERS: Record<string, ProcedureModelTier> = {
  [MODEL_ID.haiku]: "efficient",
  [MODEL_ID.sonnet]: "balanced",
  [MODEL_ID.opus]: "strong",
  [MODEL_ID.fable]: "strongest",
  [MODEL_ID.luna]: "efficient",
  [MODEL_ID.terra]: "balanced",
  [MODEL_ID.sol]: "strong",
  [MODEL_ID.astra]: "strongest",
  [MODEL_ID.glm]: "strong",
  [MODEL_ID.glmFlash]: "balanced",
};

/** Capability order over tiers. Only the relative order is meaningful. */
export const TIER_RANK: Record<ProcedureModelTier, number> = {
  efficient: 0,
  balanced: 1,
  strong: 2,
  strongest: 3,
};

/** The tier a concrete model id belongs to, or null if no engine offers it. */
export function modelTier(model: string): ProcedureModelTier | null {
  return MODEL_TIERS[model] ?? null;
}
