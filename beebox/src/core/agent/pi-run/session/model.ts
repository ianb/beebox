/**
 * The pi `Model` for an added OpenRouter id.
 *
 * pi's bundled catalog is the first source: it carries pi's request
 * settings and prices. It lacked 64 live text models in the 2026-10-29
 * probe, and refreshing it means a call to pi.dev, which this engine does
 * not make (`offline.ts`). A model pi lacks is built from OpenRouter's own
 * listing (`lookupOpenRouterModel`). A built model with wrong metadata either
 * runs at zero cost or fails (`400 Reasoning is mandatory`), so a listing
 * that cannot say what a correct request needs refuses the run.
 */

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { lookupOpenRouterModel, type CatalogModel } from "../../../openrouter-catalog.js";
import { piModelUnusable } from "../../../provider-env/openrouter-chat.js";
import type { FetchLike } from "../../../secrets/probe-registry.js";

/** pi's chat model type; pi-coding-agent does not re-export pi-ai's `Model`. */
export type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

const NO_CONTEXT_LENGTH = "OpenRouter lists no context length for it";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** pi's request settings for OpenRouter chat-completions models, as on every such model in its catalog. */
const OPENROUTER_COMPAT = {
  supportsDeveloperRole: false,
  thinkingFormat: "openrouter",
  supportsStrictMode: true,
  sendSessionAffinityHeaders: true,
} as const;

/**
 * A pi model from an OpenRouter listing. A null price is 0 (the run's cost
 * then undercounts; the cost line says so). With no listed output limit, the
 * context length is the ceiling.
 */
export function piModelFromListing(listing: CatalogModel): PiModel {
  if (listing.contextLength === null) throw piModelUnusable(listing.id, NO_CONTEXT_LENGTH);
  const { promptPerMTok, completionPerMTok, cacheReadPerMTok } = listing.pricing;
  return {
    id: listing.id,
    name: listing.name,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: OPENROUTER_BASE_URL,
    reasoning: listing.supportedParameters.includes("reasoning"),
    input: listing.inputModalities.includes("image") ? ["text", "image"] : ["text"],
    cost: { input: promptPerMTok ?? 0, output: completionPerMTok ?? 0, cacheRead: cacheReadPerMTok ?? 0, cacheWrite: 0 },
    contextWindow: listing.contextLength,
    maxTokens: listing.maxCompletionTokens ?? listing.contextLength,
    compat: OPENROUTER_COMPAT,
  };
}

/** Where pi looks a model up first: a model runtime, or pi's bundled catalog alone. */
export type PiCatalog = Pick<ModelRuntime, "getModel">;

/**
 * pi's bundled OpenRouter catalog, which is what a runtime holds when it never
 * refreshes (`offline.ts`). For admin, which has no runtime.
 */
export function piBundledCatalog(): PiCatalog {
  const byId = new Map<string, PiModel>(getBuiltinModels("openrouter").map((model) => [model.id, model]));
  return { getModel: (provider, id) => (provider === "openrouter" ? byId.get(id) : undefined) };
}

/** A model from pi's catalog, one built from OpenRouter's listing, or why neither can run. */
export type PiModelLookup =
  | { source: "pi"; model: PiModel }
  | { source: "listing"; model: PiModel; pricesKnown: boolean }
  | { source: "none"; missing: string };

/**
 * The model for `id`: pi's catalog entry; for a `:variant` id, pi's entry for
 * the base model under the full id (the variant routes the same model);
 * otherwise one built from OpenRouter's listing. Admin's warning uses this
 * too, so it and the run never disagree.
 */
export async function lookupPiModel(
  { catalog, id }: { catalog: PiCatalog; id: string },
  deps: { fetch: FetchLike; now: number },
): Promise<PiModelLookup> {
  const exact = catalog.getModel("openrouter", id);
  if (exact !== undefined) return { source: "pi", model: exact };
  const base = catalog.getModel("openrouter", id.split(":")[0] ?? id);
  if (base !== undefined) return { source: "pi", model: { ...base, id } };
  const listed = await lookupOpenRouterModel(id, deps);
  if (!listed.ok) return { source: "none", missing: `its OpenRouter listing could not be read (${listed.error})` };
  if (!listed.found) return { source: "none", missing: "neither pi nor OpenRouter lists it" };
  if (listed.model.contextLength === null) return { source: "none", missing: NO_CONTEXT_LENGTH };
  const { promptPerMTok, completionPerMTok } = listed.model.pricing;
  return { source: "listing", model: piModelFromListing(listed.model), pricesKnown: promptPerMTok !== null && completionPerMTok !== null };
}

/**
 * A resolved model, and whether its input and output prices are known. pi's
 * catalog always prices its models; a listing may not, and a budgeted run
 * cannot be held to a budget it cannot estimate.
 */
export interface ResolvedPiModel {
  model: PiModel;
  pricesKnown: boolean;
}

/** `lookupPiModel` for a run: a model that cannot run refuses with `OpenRouterSetupError`. */
export async function resolvePiModel(
  args: { catalog: PiCatalog; id: string },
  deps: { fetch: FetchLike; now: number },
): Promise<ResolvedPiModel> {
  const found = await lookupPiModel(args, deps);
  if (found.source === "none") throw piModelUnusable(args.id, found.missing);
  return { model: found.model, pricesKnown: found.source === "pi" || found.pricesKnown };
}
