import { MODEL_ID } from "./model-ids.js";

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

/**
 * Provider-relative policy, not a claim that models on the same row have equal
 * capability. Codex currently has three family members, so both high-end tiers
 * select its flagship; that can diverge later without changing procedure cards.
 */
const PROCEDURE_MODELS: Record<AgentEngine, Record<ProcedureModelTier, string>> = {
  claude: {
    efficient: MODEL_ID.haiku,
    balanced: MODEL_ID.sonnet,
    strong: MODEL_ID.opus,
    strongest: MODEL_ID.fable,
  },
  codex: {
    efficient: MODEL_ID.luna,
    balanced: MODEL_ID.terra,
    strong: MODEL_ID.sol,
    strongest: MODEL_ID.sol,
  },
};

/** Resolve a portable procedure tier (or legacy alias) for one native engine. */
export function resolveProcedureModel(engine: AgentEngine, model: ProcedureModelName): string {
  return PROCEDURE_MODELS[engine][LEGACY_TIER[model]];
}

/**
 * Tier of a concrete model id — the reverse of {@link PROCEDURE_MODELS}, used to
 * translate a box's pinned model for an engine that cannot run it and to rank
 * one model against another (smarter/dumber).
 *
 * The reverse is lossy where the forward table is: Codex's `strong` and
 * `strongest` both select Sol, so Sol reverses to the lower of the two. That
 * flattening is deliberate and visible here rather than inferred at a call site.
 */
const MODEL_TIERS: Record<string, ProcedureModelTier> = {
  [MODEL_ID.haiku]: "efficient",
  [MODEL_ID.sonnet]: "balanced",
  [MODEL_ID.opus]: "strong",
  [MODEL_ID.fable]: "strongest",
  [MODEL_ID.luna]: "efficient",
  [MODEL_ID.terra]: "balanced",
  [MODEL_ID.sol]: "strong",
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
