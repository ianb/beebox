import { MODEL_ID } from "./model-ids.js";
import type { AgentEngine } from "./agent-models.js";

export type ChatAgentEngine = AgentEngine;

export interface ChatModelOption {
  label: string;
  model: string | null;
}

/** Validate an engine value crossing a runtime/API boundary. */
export function parseChatAgentEngine(value: unknown): ChatAgentEngine | null {
  return value === "claude" || value === "codex" ? value : null;
}

const OPTIONS: Record<ChatAgentEngine, readonly ChatModelOption[]> = {
  // Strongest first, under the default — the same order the codex list already
  // used. The claude list used to run weakest-first, so the two engines' menus
  // disagreed and Haiku sat at the top of one of them.
  claude: [
    { label: "Default (Opus)", model: null },
    { label: "Fable 5.1", model: MODEL_ID.fable },
    { label: "Opus 5", model: MODEL_ID.opus },
    { label: "Sonnet 5", model: MODEL_ID.sonnet },
    { label: "Haiku 4.5", model: MODEL_ID.haiku },
  ],
  codex: [
    { label: "Default (Codex)", model: null },
    { label: "Astra", model: MODEL_ID.astra },
    { label: "Sol", model: MODEL_ID.sol },
    { label: "Terra", model: MODEL_ID.terra },
    { label: "Luna", model: MODEL_ID.luna },
  ],
};

export function chatModelOptions(engine: ChatAgentEngine): readonly ChatModelOption[] {
  return OPTIONS[engine];
}

export function isChatModelAllowed(engine: ChatAgentEngine, model: string | null): boolean {
  return OPTIONS[engine].some((option) => option.model === model);
}

/** Ignore a persisted model that belongs to a different native harness. */
export function chatModelForEngine(engine: ChatAgentEngine, model: string | null): string | null {
  return isChatModelAllowed(engine, model) ? model : null;
}
