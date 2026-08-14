import { MODEL_ID } from "./model-ids.js";

export type ChatAgentEngine = "claude" | "codex";

export interface ChatModelOption {
  label: string;
  model: string | null;
}

const OPTIONS: Record<ChatAgentEngine, readonly ChatModelOption[]> = {
  claude: [
    { label: "Default (Opus)", model: null },
    { label: "Haiku 4.5", model: MODEL_ID.haiku },
    { label: "Sonnet 5", model: MODEL_ID.sonnet },
    { label: "Opus 5", model: MODEL_ID.opus },
    { label: "Fable 5", model: MODEL_ID.fable },
  ],
  codex: [
    { label: "Default (Codex)", model: null },
    { label: "GPT-5.6 Sol", model: "gpt-5.6-sol" },
    { label: "GPT-5.6 Terra", model: "gpt-5.6-terra" },
  ],
};

export function chatModelOptions(engine: ChatAgentEngine): readonly ChatModelOption[] {
  return OPTIONS[engine];
}

export function isChatModelAllowed(engine: ChatAgentEngine, model: string | null): boolean {
  return OPTIONS[engine].some((option) => option.model === model);
}
