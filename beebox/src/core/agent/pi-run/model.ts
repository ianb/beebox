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

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { lookupOpenRouterModel, type CatalogModel } from "../../openrouter-catalog.js";
import { piModelUnusable } from "../../provider-env/openrouter-chat.js";
import type { FetchLike } from "../../secrets/probe-registry.js";

/** pi's chat model type; pi-coding-agent does not re-export pi-ai's `Model`. */
export type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

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
  if (listing.contextLength === null) throw piModelUnusable(listing.id, "OpenRouter lists no context length for it");
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

/**
 * The model for `id`: pi's catalog entry; for a `:variant` id, pi's entry for
 * the base model under the full id (the variant routes the same model);
 * otherwise one built from OpenRouter's listing.
 */
export async function resolvePiModel(
  { runtime, id }: { runtime: ModelRuntime; id: string },
  deps: { fetch: FetchLike; now: number },
): Promise<PiModel> {
  const exact = runtime.getModel("openrouter", id);
  if (exact !== undefined) return exact;
  const base = runtime.getModel("openrouter", id.split(":")[0] ?? id);
  if (base !== undefined) return { ...base, id };
  const listed = await lookupOpenRouterModel(id, deps);
  if (!listed.ok) throw piModelUnusable(id, `its OpenRouter listing could not be read (${listed.error})`);
  if (!listed.found) throw piModelUnusable(id, "neither pi nor OpenRouter lists it");
  return piModelFromListing(listed.model);
}
