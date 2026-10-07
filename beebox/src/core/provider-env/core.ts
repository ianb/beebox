/**
 * The one seam that decides what a claude-engine run's child env needs for
 * its model's provider — first-party (only the box's telemetry choice), GLM
 * (Z.ai's endpoint and the `glm` key), or an owner-added OpenRouter model. Every spawn path calls it:
 * chat start, prewarm, thread start, batch runs, and both preflights. A
 * refusal throws {@link ProviderSetupError} before any subprocess exists, and
 * nothing here ever falls back to a subscription model — quietly changing who
 * answers is worse than an error.
 */

import { assertNever } from "../../shared/invariant.js";
import { isThirdPartyModel, providerOf } from "../../shared/agent-models.js";
import { loadClaudeCodeTelemetry } from "../box/config.js";
import { glmEnvAdditions, resolveGlmKeyOrThrow } from "../glm-key.js";
import { openRouterChatAdditions } from "./openrouter-chat.js";
import { ProviderSetupError } from "../provider-setup-error.js";

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
  const additions = model === null || model === undefined
    ? await firstPartyAdditions(boxRoot)
    : await additionsFor({ boxRoot, model, purpose });
  if (additions !== null && params.env) Object.assign(params.env, additions);
  return additions;
}

/**
 * For a run that is already live: the refusal its model's provider would give
 * a fresh spawn now, or null when it may continue. A live subprocess holds the
 * env it started with, so without this a model removed in admin, or a revoked
 * key, keeps billing until the next cold start. The caller reports the
 * refusal and closes the run, so the next attempt refuses at spawn too.
 */
export async function liveProviderRefusal(params: { boxRoot: string; model: string | null }): Promise<ProviderSetupError | null> {
  if (!isThirdPartyModel(params.model)) return null;
  try {
    await providerEnvAdditions({ boxRoot: params.boxRoot, model: params.model, purpose: "chat-send" });
    return null;
  } catch (e) {
    if (e instanceof ProviderSetupError) return e;
    throw e;
  }
}

/**
 * Claude Code's own traffic to Anthropic, switched off for every run whose
 * model answers somewhere else. The CLI treats a custom `ANTHROPIC_BASE_URL`
 * as the Claude API, so usage metrics stay on unless disabled.
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also stops feature-flag fetches,
 * update and release-note checks, and feedback uploads; any value, even `0`,
 * turns it on, so first-party runs never get it; their telemetry follows the
 * box setting instead ({@link firstPartyAdditions}). WebFetch's domain check
 * still sends each hostname to Anthropic (`docs/security-report.md`).
 */
const NO_ANTHROPIC_TELEMETRY = {
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
} as const;

/**
 * A first-party run sends Claude Code's metrics and error reports unless the
 * box turned them off (`claudeCodeTelemetry`). Nonessential traffic stays on:
 * the owner chose Anthropic for these runs, and the setting is about
 * telemetry only.
 */
async function firstPartyAdditions(boxRoot: string): Promise<Record<string, string> | null> {
  if ((await loadClaudeCodeTelemetry(boxRoot)) === "on") return null;
  return { DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" };
}

/** Any run that points the CLI at another endpoint also gets {@link NO_ANTHROPIC_TELEMETRY}, so a new provider cannot forget it. */
async function additionsFor(params: { boxRoot: string; model: string; purpose: string }): Promise<Record<string, string> | null> {
  const provider = providerOf(params.model);
  if (provider === "anthropic") return firstPartyAdditions(params.boxRoot);
  const endpoint = await endpointFor(params);
  return endpoint === null ? null : { ...endpoint, ...NO_ANTHROPIC_TELEMETRY };
}

async function endpointFor(params: { boxRoot: string; model: string; purpose: string }): Promise<Record<string, string> | null> {
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
