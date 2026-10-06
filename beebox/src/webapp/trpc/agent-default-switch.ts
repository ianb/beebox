/**
 * Moves a box's default agent to one that can run, when the configured one
 * cannot. Called after an agent sign-in in the admin UI, and when an owner
 * opens a box whose default is broken (a CLI login outside the UI).
 */

import { checkAgentReadiness, type AgentReadiness, type ReadinessServices } from "../../core/agent/readiness.js";
import { loadAddedModels, loadBoxConfig, type AgentEngine } from "../../core/box/config.js";
import { updateBoxConfigFields } from "../box-config-write.js";

export type EngineSwitch =
  | { switched: false; readiness: AgentReadiness }
  | { switched: true; readiness: AgentReadiness; agentEngine: AgentEngine; agentModel: string | null };

/**
 * When the box's default cannot run and another provider can, move the
 * default to it: Claude Code first, then Codex, then the first added
 * OpenRouter model. A default that works is never touched, so logging in to
 * a second provider later changes nothing. The pinned model is cleared on an
 * engine switch so the new engine's own default applies.
 */
export async function reconcileDefaultEngine(boxRoot: string, services: ReadinessServices): Promise<EngineSwitch> {
  const readiness = await checkAgentReadiness(boxRoot, services);
  if (readiness.defaultReady) return { switched: false, readiness };
  const target = await pickTarget(boxRoot, readiness);
  if (target === null) return { switched: false, readiness };
  const config = await loadBoxConfig(boxRoot);
  const result = await updateBoxConfigFields({
    boxRoot,
    agentEngine: target.agentEngine,
    agentModel: target.agentModel,
    // An explicit engine list must include the new default; an absent one
    // already means "just the default".
    ...(config.engines === undefined ? {} : { engines: { ...config.engines, [target.agentEngine]: true } }),
  });
  if (result.commitError) {
    console.error(`[agent-readiness] default engine switched but its Git commit failed for ${boxRoot}:`, result.commitError);
  }
  return { switched: true, readiness: await checkAgentReadiness(boxRoot, services), ...target };
}

async function pickTarget(boxRoot: string, readiness: AgentReadiness): Promise<{ agentEngine: AgentEngine; agentModel: string | null } | null> {
  if (readiness.claude === "ready") return { agentEngine: "claude", agentModel: null };
  if (readiness.codex === "ready") return { agentEngine: "codex", agentModel: null };
  if (readiness.openrouter === "ready") {
    const [first] = await loadAddedModels(boxRoot);
    if (first !== undefined) return { agentEngine: "claude", agentModel: first.id };
  }
  return null;
}
