/**
 * OpenRouter as a FALLBACK route for the box's optional model-backed services
 * (`issues/exploration/2026-08-31-openrouter-optional-services-consolidation.md`).
 *
 * The product shape is one secret and no configuration: grant a box an
 * `openrouter` key and the services that can run through OpenRouter simply do.
 * There is no base-URL setting, and no per-service provider field — the switch
 * happens here, in code.
 *
 * **Precedence: the service's own provider key wins.** An `openai` key keeps
 * embeddings on OpenAI even when an OpenRouter key is also granted. That is
 * deliberate, and it is the conservative direction: adding a credential must
 * never silently move an already-working box onto a different egress path, and
 * for embeddings it must never risk invalidating an index built with the direct
 * key. Consolidating is therefore an explicit act — remove the direct key from
 * the store, and the service falls through to here.
 *
 * **What CANNOT come here, and why**, so the next reader does not re-derive it:
 *
 * - **Text-to-speech.** OpenRouter carries no OpenAI TTS model at all, and our
 *   voice vocabulary (`shared/voice-models.ts`) is a closed set in the
 *   personality card schema. A substitute is a schema migration, not a route.
 * - **The three realtime dictation paths.** OpenRouter has no websocket or
 *   realtime surface — the words do not appear in its OpenAPI document.
 * - **Deepgram batch transcription.** The model is there, but OpenRouter's
 *   normalized word shape has no confidence field, and per-word confidence is
 *   the reason that backend exists.
 * - **Voxtral HQ transcription.** Measured 2026-09-06:
 *   `mistralai/voxtral-mini-transcribe` refuses `verbose_json` through
 *   OpenRouter and cannot diarize at all, so `voxtral-diarized` would lose the
 *   only thing it is for. `transcription/openrouter.ts` carries the evidence.
 * - **The non-HQ batch transcription path.** It passes a context-bias `prompt`
 *   (`core/preactions/transcribe.ts`), and OpenRouter's transcription request
 *   has no such parameter. The HQ path passes none, so the HQ path can route.
 */

import { refusalAllowsLegacyFallback } from "./secrets/legacy-fallback.js";
import { resolveSecret } from "./secrets/resolve.js";

/** The store name this key lives under. */
const OPENROUTER_SECRET_NAME = "openrouter";

/** Every OpenRouter endpoint hangs off this; nothing configures it. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The `provider` block sent with every OpenRouter request we make.
 *
 * An aggregator does not have to mean an unknown egress path. OpenRouter takes
 * routing preferences per request, so the box states its posture in code rather
 * than depending on an account-level toggle nobody can see from here, and the
 * rule is one sentence: **route to the company the direct path would have
 * reached.** `only` names that provider and `allow_fallbacks: false` means a
 * request fails rather than quietly landing somewhere else. OpenRouter is
 * standing in for a credential and a bill here — not shopping for a cheaper
 * host — so the request going to OpenAI, Google, or Mistral exactly as it does
 * today is the property worth keeping. For embeddings it is more than a
 * posture: the same model served by a different host is not a promise of the
 * same vectors, and our index assumes one embedder.
 *
 * `data_collection: "deny"` refuses any provider that may train on the content.
 *
 * **`zdr: true` is deliberately NOT set.** Checked 2026-09-06: the only
 * zero-retention endpoint for `openai/text-embedding-3-small` is Azure, not
 * OpenAI, and `openai/whisper-1` has no ZDR endpoint at all — so asking for it
 * would either break the request or force the exact host switch the pin exists
 * to prevent. Going direct to OpenAI today carries that provider's ordinary
 * retention too; demanding better of the OpenRouter route than of the route it
 * replaces would buy nothing and cost the feature.
 */
export function openRouterProvider(only: string): {
  only: string[];
  allow_fallbacks: false;
  data_collection: "deny";
} {
  return { only: [only], allow_fallbacks: false, data_collection: "deny" };
}

/**
 * Where a workload's request is going, and with which credential. `via` exists
 * so health output and error messages can name the route the boxholder is
 * actually on — "semantic search is using OpenRouter" is the visible half of a
 * switch that otherwise happens silently.
 */
export interface ModelRoute {
  via: "direct" | "openrouter";
  apiKey: string;
}

/**
 * The box's OpenRouter key, or null when it has none.
 *
 * Order follows the other resolvers (`docs/plans/secret-custody.md`, Track 3):
 * the machine store's `openrouter` entry at `server` access, then
 * `BBX_OPENROUTER_API_KEY`. There is no legacy per-box file arm — this
 * credential is new, so it never had one, and adding one would be inventing
 * a deprecated path.
 */
export async function getOpenRouterKey(
  boxRoot: string | undefined,
  read: { purpose: string; observe?: boolean | undefined },
): Promise<string | null> {
  if (boxRoot !== undefined) {
    const resolved = await resolveSecret({
      boxRoot,
      name: OPENROUTER_SECRET_NAME,
      purpose: read.purpose,
      access: "server",
      ...(read.observe !== undefined && { observe: read.observe }),
    });
    if (resolved.ok) {
      if (resolved.value.suspect) {
        console.warn("[openrouter] the stored OpenRouter key last failed a probe — it may be expired.");
      }
      return resolved.value.value;
    }
    // Only "no such secret on this machine" degrades to the env var; every
    // other refusal is "not configured" (`secrets/legacy-fallback.ts`).
    if (!refusalAllowsLegacyFallback({ reader: "openrouter", refusal: resolved.error })) return null;
  }
  return process.env["BBX_OPENROUTER_API_KEY"] ?? null;
}

/**
 * Pick the route for one workload: its own provider key if the box has one,
 * otherwise OpenRouter, otherwise null (the service stays unconfigured, which
 * is what every caller here already handles).
 *
 * `directKey` is passed in already-resolved rather than resolved here, because
 * each workload's direct key has its own resolver with its own legacy arms and
 * its own typed errors — this decides *which* route, it does not take over
 * how the direct one is found.
 */
export async function routeVia(opts: {
  boxRoot: string | undefined;
  purpose: string;
  directKey: string | null;
  observe?: boolean | undefined;
}): Promise<ModelRoute | null> {
  if (opts.directKey !== null) return { via: "direct", apiKey: opts.directKey };
  const key = await getOpenRouterKey(opts.boxRoot, {
    purpose: opts.purpose,
    ...(opts.observe !== undefined && { observe: opts.observe }),
  });
  return key === null ? null : { via: "openrouter", apiKey: key };
}
