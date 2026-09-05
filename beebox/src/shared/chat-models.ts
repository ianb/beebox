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
  claude: [
    { label: "Default (Opus)", model: null },
    { label: "Haiku 4.5", model: MODEL_ID.haiku },
    { label: "Sonnet 5", model: MODEL_ID.sonnet },
    { label: "Opus 5", model: MODEL_ID.opus },
    { label: "Fable 5.1", model: MODEL_ID.fable },
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
