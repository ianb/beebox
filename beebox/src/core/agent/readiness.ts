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

import { AUTH_PROBE_INCONCLUSIVE, type ClaudeCliService } from "../../services/claude-cli.js";
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

export async function checkAgentReadiness(boxRoot: string, services: ReadinessServices): Promise<AgentReadiness> {
  const [claude, codex, openrouter] = await Promise.all([
    services.claudeCli.authStatus().then(claudeState),
    services.codexCli.authStatus().then(codexState),
    openrouterState(boxRoot),
  ]);
  const states = { claude, codex, openrouter };
  const anyReady = usable(claude) || usable(codex) || openrouter === "ready";
  return { ...states, anyReady, defaultReady: usable(await defaultState(boxRoot, states)) };
}
