/**
 * OpenRouter models on the claude engine — the one OpenRouter use that needs
 * an owner act in admin (`docs/plans/openrouter-chat-models.md`).
 *
 * `core/openrouter.ts` routes optional services through a granted key with no
 * configuration, because they cost cents. A chat or agent turn is a different
 * order of spend, so here the key alone runs nothing: the model must also be
 * in the box's `openrouterModels`, which only the admin page writes. Both are
 * checked at every spawn; the picker hiding rows is a courtesy.
 *
 * Claude Code sends these requests, not us, so the `provider` block
 * `openRouterProvider` pins for the optional services cannot ride along. Host
 * choice and data policy for chat are the OpenRouter account's settings.
 */

import { loadAddedModels } from "./box/config.js";
import { OPENROUTER_SECRET_NAME } from "./openrouter.js";
import { ProviderSetupError } from "./provider-setup-error.js";
import { resolveSecret } from "./secrets/resolve.js";

/** OpenRouter's Anthropic-compatible endpoint — the CLI appends `/v1/messages`. */
const OPENROUTER_ANTHROPIC_BASE_URL = "https://openrouter.ai/api";

/**
 * A slow first token otherwise reads as a hang; the same allowance GLM gets
 * (`core/glm-key.ts`).
 */
const OPENROUTER_API_TIMEOUT_MS = "3000000";

/**
 * Claude Code's own model roles. Each is pinned to the chosen model so no
 * background call (a haiku-role summary, a subagent) goes out under a
 * `claude-*` id and bills Anthropic prices through this key. The spike saw no
 * such call without them (plan, Track 1 (e)); they stay as the guard.
 */
const ROLE_VARIABLES = [
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
] as const;

/** Pure — the child-env additions that point a claude-engine run at one OpenRouter model. */
export function openRouterChatEnv(params: { key: string; model: string }): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: OPENROUTER_ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: params.key,
    // Blank, not absent: a real Anthropic key here is sent as `x-api-key` and
    // may authenticate against Anthropic instead (OpenRouter's Claude Code guide).
    ANTHROPIC_API_KEY: "",
    API_TIMEOUT_MS: OPENROUTER_API_TIMEOUT_MS,
    ...Object.fromEntries(ROLE_VARIABLES.map((name) => [name, params.model])),
  };
}

/** The model is not added for this box, or the box has no usable key. */
export class OpenRouterSetupError extends ProviderSetupError {
  constructor(message: string) {
    super("openrouter", message);
    this.name = "OpenRouterSetupError";
  }
}

/**
 * The gate: resolve the env for one OpenRouter model, or throw
 * {@link OpenRouterSetupError}. List membership is checked before the key so
 * a removed model refuses the same way whether or not a key exists.
 */
export async function openRouterChatAdditions(params: {
  boxRoot: string;
  model: string;
  purpose: string;
}): Promise<Record<string, string>> {
  const { boxRoot, model } = params;
  if (!(await loadAddedModels(boxRoot)).some((m) => m.id === model)) {
    throw new OpenRouterSetupError(
      `This run uses the OpenRouter model ${model}, which is not added for this box. `
        + "Add it in Admin → OpenRouter models, or pick another model.",
    );
  }
  const resolved = await resolveSecret({ boxRoot, name: OPENROUTER_SECRET_NAME, purpose: params.purpose, access: "server" });
  if (!resolved.ok) {
    throw new OpenRouterSetupError(
      `This run uses the OpenRouter model ${model}, but no usable OpenRouter key is available for this box `
        + `(${resolved.error.message}). Add one in Admin → Secrets and grant it to this box.`,
    );
  }
  return openRouterChatEnv({ key: resolved.value.value, model });
}
