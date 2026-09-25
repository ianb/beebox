/**
 * A claude-engine run selected a third-party model (GLM, or an owner-added
 * OpenRouter model) that this box cannot run yet. Each provider's subclass
 * names its own fix; callers catch this base to refuse the turn before any
 * subprocess exists (`core/provider-env.ts`).
 */
export class ProviderSetupError extends Error {
  constructor(readonly provider: "glm" | "openrouter", message: string) {
    super(message);
    this.name = "ProviderSetupError";
  }
}
