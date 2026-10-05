/**
 * Agent readiness: can anything in this box run an agent right now, and can
 * the box's default?
 *
 * Three providers can carry a chat: a Claude Code login, a Codex login, and
 * an OpenRouter key with at least one added model (which rides the claude
 * engine and needs no Claude login). A packaged install starts with none of
 * them, and its boxholder has no shell to run `claude auth login` in, so the
 * web UI uses this to block input and send the owner to Admin → Agents.
 *
 * An inconclusive probe reads as `unknown`, which counts as usable for
 * blocking (the run-time preflight lets it through too) and as unusable for
 * switching (the default is never moved on a guess).
 */

import { AUTH_PROBE_INCONCLUSIVE, CLI_MISSING, type ClaudeCliService } from "../../services/claude-cli.js";
import type { CodexAuthStatus, CodexCliService } from "../../services/codex-cli/core.js";
import { isThirdPartyModel, providerOf } from "../../shared/agent-models.js";
import { loadAddedModels, loadAgentEngine, loadBoxModel } from "../box/config.js";
import { glmKeyUsable } from "../glm-key.js";
import { openRouterKeyUsable } from "../openrouter.js";

export type ProviderState = "ready" | "not-ready" | "unknown";

export interface AgentReadiness {
  claude: ProviderState;
  codex: ProviderState;
  openrouter: ProviderState;
  /** At least one provider can run a chat. */
  anyReady: boolean;
  /** The box's default engine and pinned model can run. */
  defaultReady: boolean;
}

export interface ReadinessServices {
  claudeCli: ClaudeCliService;
  codexCli: CodexCliService;
}

const usable = (state: ProviderState): boolean => state !== "not-ready";

function claudeState(status: Record<string, unknown>): ProviderState {
  if (status[CLI_MISSING] === true) return "not-ready";
  if (AUTH_PROBE_INCONCLUSIVE in status) return "unknown";
  return status["loggedIn"] === true ? "ready" : "not-ready";
}

function codexState(status: CodexAuthStatus): ProviderState {
  switch (status.kind) {
    case "logged-in": return "ready";
    case "inconclusive": return "unknown";
    case "logged-out":
    case "unavailable": return "not-ready";
  }
}

async function openrouterState(boxRoot: string): Promise<ProviderState> {
  if ((await loadAddedModels(boxRoot)).length === 0) return "not-ready";
  return (await openRouterKeyUsable(boxRoot)) ? "ready" : "not-ready";
}

async function defaultState(boxRoot: string, states: Record<"claude" | "codex" | "openrouter", ProviderState>): Promise<ProviderState> {
  const engine = await loadAgentEngine(boxRoot);
  if (engine === "codex") return states.codex;
  const model = await loadBoxModel(boxRoot);
  if (!isThirdPartyModel(model)) return states.claude;
  if (providerOf(model) === "glm") return (await glmKeyUsable(boxRoot)) ? "ready" : "not-ready";
  const added = await loadAddedModels(boxRoot);
  return added.some((m) => m.id === model) ? states.openrouter : "not-ready";
}

/**
 * Login probes spawn a CLI each, and the web UI asks on every page load and
 * window focus, so answers are cached per process (logins are machine-wide):
 * a sign-in for minutes, anything else for seconds so a new sign-in shows up
 * quickly. The admin page's live status checks refresh the cache, so the
 * sign-in it is polling for unblocks chat right away.
 */
const READY_TTL_MS = 5 * 60 * 1000;
const NOT_READY_TTL_MS = 10 * 1000;

type Provider = "claude" | "codex";
const probeCache = new Map<Provider, { state: ProviderState; at: number }>();

function remember(provider: Provider, state: ProviderState): ProviderState {
  probeCache.set(provider, { state, at: Date.now() });
  return state;
}

async function cachedProbe(provider: Provider, probe: () => Promise<ProviderState>): Promise<ProviderState> {
  const hit = probeCache.get(provider);
  if (hit !== undefined && Date.now() - hit.at < (hit.state === "ready" ? READY_TTL_MS : NOT_READY_TTL_MS)) return hit.state;
  return remember(provider, await probe());
}

/** Record a live Claude status (the admin page's own probe). */
export function rememberClaudeStatus(status: Record<string, unknown>): void {
  remember("claude", claudeState(status));
}

/** Record a live Codex status (the admin page's own probe). */
export function rememberCodexStatus(status: CodexAuthStatus): void {
  remember("codex", codexState(status));
}

/** Forget cached answers, after a logout or between test steps. */
export function resetAgentReadinessCache(): void {
  probeCache.clear();
}

export async function checkAgentReadiness(boxRoot: string, services: ReadinessServices): Promise<AgentReadiness> {
  const [claude, codex, openrouter] = await Promise.all([
    cachedProbe("claude", () => services.claudeCli.authStatus().then(claudeState)),
    cachedProbe("codex", () => services.codexCli.authStatus().then(codexState)),
    openrouterState(boxRoot),
  ]);
  const states = { claude, codex, openrouter };
  const defaultReady = usable(await defaultState(boxRoot, states));
  // A runnable default counts even when it is none of the three (a GLM
  // model with its key).
  const anyReady = usable(claude) || usable(codex) || openrouter === "ready" || defaultReady;
  return { ...states, anyReady, defaultReady };
}
