/**
 * The one seam that decides what a claude-engine run's child env needs for
 * its model's provider — first-party (nothing), GLM (Z.ai's endpoint and the
 * `glm` key), or an owner-added OpenRouter model. Every spawn path calls it:
 * chat start, prewarm, thread start, batch runs, and both preflights. A
 * refusal throws {@link ProviderSetupError} before any subprocess exists, and
 * nothing here ever falls back to a subscription model — quietly changing who
 * answers is worse than an error.
 */

import { assertNever } from "../lib/invariant.js";
import { providerOf } from "../shared/agent-models.js";
import { glmEnvAdditions, resolveGlmKeyOrThrow } from "./glm-key.js";
import { openRouterChatAdditions } from "./openrouter-chat.js";

/** True when a run on this model goes somewhere other than first-party Anthropic via the claude engine. */
export function isThirdPartyModel(model: string | null | undefined): model is string {
  if (model === null || model === undefined) return false;
  const provider = providerOf(model);
  return provider === "glm" || provider === "openrouter";
}

/**
 * The env additions for a resolved model, or null when it needs none.
 * Throws {@link ProviderSetupError} when the box cannot run it. When `env` is
 * given, the additions are also merged into it in place.
 */
export async function providerEnvAdditions(params: {
  boxRoot: string;
  /** The resolved model — null/undefined means the harness default, first-party. */
  model: string | null | undefined;
  /** Access-log label for the key resolution. */
  purpose: string;
  env?: Record<string, string | undefined>;
}): Promise<Record<string, string> | null> {
  const { boxRoot, model, purpose } = params;
  if (model === null || model === undefined) return null;
  const additions = await additionsFor({ boxRoot, model, purpose });
  if (additions !== null && params.env) Object.assign(params.env, additions);
  return additions;
}

async function additionsFor(params: { boxRoot: string; model: string; purpose: string }): Promise<Record<string, string> | null> {
  const provider = providerOf(params.model);
  switch (provider) {
    case "anthropic":
    case "openai":
      return null;
    case "glm":
      return { ...glmEnvAdditions(await resolveGlmKeyOrThrow(params.boxRoot, { purpose: params.purpose })) };
    case "openrouter":
      return openRouterChatAdditions(params);
    default:
      return assertNever(provider);
  }
}
