/**
 * The two OpenRouter reads the admin page makes about chat models: the public
 * model catalog (no key — prices, context, tool support) and the key's own
 * usage figures (with the key). Adding a model is validated against the
 * catalog, so a typo or a model with no tool calling fails in admin rather
 * than in a chat turn (`docs/plans/openrouter-chat-models.md`, Track 4).
 *
 * Neither call spends anything. Both take an injected `fetch` so tests never
 * leave the machine; the fixtures are recorded real responses.
 */

import { z } from "zod";
import { errorMessage } from "../lib/error-guards.js";
import type { FetchLike } from "./secrets/probe-registry.js";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const KEY_URL = "https://openrouter.ai/api/v1/key";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/** OpenRouter prices are dollar strings per token; missing means not offered. */
const priceSchema = z.string().optional();

const catalogSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string(),
    context_length: z.number().nullable().optional(),
    supported_parameters: z.array(z.string()).optional(),
    pricing: z.object({ prompt: priceSchema, completion: priceSchema, input_cache_read: priceSchema }),
  })),
});
type CatalogEntry = z.infer<typeof catalogSchema>["data"][number];

/** What admin shows and checks for one model. Prices are dollars per million tokens. */
export interface CatalogModel {
  name: string;
  contextLength: number | null;
  supportsTools: boolean;
  pricing: { promptPerMTok: number | null; completionPerMTok: number | null; cacheReadPerMTok: number | null };
}

export type CatalogLookup = { ok: true; found: false } | { ok: true; found: true; model: CatalogModel } | { ok: false; error: string };

let cached: { at: number; entries: CatalogEntry[] } | null = null;

function perMillion(price: string | undefined): number | null {
  if (price === undefined) return null;
  const perToken = Number(price);
  // A negative price is OpenRouter's "varies" sentinel on router models.
  return Number.isFinite(perToken) && perToken >= 0 ? Math.round(perToken * 1e6 * 1e4) / 1e4 : null;
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** One GET, as a Result: every failure here is a message for the admin page. */
async function getJson(fetchImpl: FetchLike, request: { url: string; headers?: Record<string, string> }): Promise<Read<unknown>> {
  try {
    const response = await fetchImpl(request.url, {
      ...(request.headers ? { headers: request.headers } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `${request.url} answered HTTP ${response.status}` };
    return { ok: true, value: await response.json() };
  } catch (e) {
    return { ok: false, error: `${request.url} could not be read: ${errorMessage(e)}` };
  }
}

async function loadCatalog(fetchImpl: FetchLike, now: number): Promise<Read<CatalogEntry[]>> {
  if (cached !== null && now - cached.at < CATALOG_TTL_MS) return { ok: true, value: cached.entries };
  const read = await getJson(fetchImpl, { url: CATALOG_URL });
  if (!read.ok) return read;
  const parsed = catalogSchema.safeParse(read.value);
  if (!parsed.success) return { ok: false, error: `the model catalog had an unexpected shape: ${parsed.error.message}` };
  cached = { at: now, entries: parsed.data.data };
  return { ok: true, value: cached.entries };
}

/**
 * Look one id up in the catalog. A `:variant` suffix (`:exacto`) is a routing
 * choice on the same model, so the lookup uses the base id. Cached for an
 * hour: prices move slowly, and the admin page reads every added model.
 */
export async function lookupOpenRouterModel(
  id: string,
  deps: { fetch: FetchLike; now: number },
): Promise<CatalogLookup> {
  const base = id.split(":")[0];
  const catalog = await loadCatalog(deps.fetch, deps.now);
  if (!catalog.ok) return catalog;
  const entry = catalog.value.find((m) => m.id === base);
  if (entry === undefined) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    model: {
      name: entry.name,
      contextLength: entry.context_length ?? null,
      supportsTools: entry.supported_parameters?.includes("tools") === true,
      pricing: {
        promptPerMTok: perMillion(entry.pricing.prompt),
        completionPerMTok: perMillion(entry.pricing.completion),
        cacheReadPerMTok: perMillion(entry.pricing.input_cache_read),
      },
    },
  };
}

/** Forget the cached catalog — tests only need this between fixtures. */
export function clearOpenRouterCatalogCache(): void {
  cached = null;
}

const keySchema = z.object({
  data: z.object({
    usage: z.number(),
    usage_monthly: z.number(),
    limit: z.number().nullable(),
    limit_remaining: z.number().nullable(),
    limit_reset: z.string().nullable(),
  }),
});

/** What the key has spent, across every use of it — chat, embeddings, transcription. */
export interface KeyUsage {
  totalUsd: number;
  monthUsd: number;
  limitUsd: number | null;
  limitRemainingUsd: number | null;
  limitReset: string | null;
}

/**
 * The key's spend as OpenRouter reports it. The figure is the key's, not this
 * box's or this model's: per-model accounting was declined (boxholder,
 * 2026-09-19). It also lags real use by a minute or more (plan, Track 1 (g)).
 */
export async function readOpenRouterKeyUsage(
  key: string,
  deps: { fetch: FetchLike },
): Promise<{ ok: true; usage: KeyUsage } | { ok: false; error: string }> {
  const read = await getJson(deps.fetch, { url: KEY_URL, headers: { Authorization: `Bearer ${key}` } });
  if (!read.ok) return read;
  const parsed = keySchema.safeParse(read.value);
  if (!parsed.success) return { ok: false, error: `the key endpoint had an unexpected shape: ${parsed.error.message}` };
  const d = parsed.data.data;
  return {
    ok: true,
    usage: { totalUsd: d.usage, monthUsd: d.usage_monthly, limitUsd: d.limit, limitRemainingUsd: d.limit_remaining, limitReset: d.limit_reset },
  };
}
