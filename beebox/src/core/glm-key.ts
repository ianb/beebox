/**
 * Resolve the box's GLM (Z.ai) API key — the credential behind the `glm-*`
 * agent models, which ride the claude engine against Z.ai's
 * Anthropic-compatible endpoint (`docs/plans/box-glm-provider.md`).
 *
 * The key lives in the machine secret store's `glm` entry at `server` access,
 * same as every connector credential: the server resolves it and injects it
 * into the agent child's env for GLM runs; the agent can read its own env, but
 * nothing agent-authored can grant itself access. Precedent:
 * `core/gemini-key.ts`.
 *
 * Unlike `getGeminiApiKey`, refusals are NOT collapsed to null. For GLM the
 * key is load-bearing for the selected model — a missing key that silently
 * fell back to first-party would switch providers (and send the transcript to
 * a different processor) mid-session. A run on a GLM model without a usable
 * key refuses, loudly, with the two setup commands.
 */

import { resolveSecret } from "./secrets/resolve.js";
import type { SecretRefusal } from "./secrets/errors.js";
import { providerOf } from "../shared/agent-models.js";

/** The store name this key lives under. */
const GLM_SECRET_NAME = "glm";

/** Z.ai's Anthropic-compatible endpoint. The only place this literal lives. */
export const GLM_BASE_URL = "https://api.z.ai/api/anthropic";

/**
 * First token on GLM can lag far past the CLI's default API timeout, and a
 * mid-turn timeout reads as a hang — the same constant and rationale as the
 * dev-side shim (`bin/lib/glm-provider.sh`).
 */
export const GLM_API_TIMEOUT_MS = "3000000";

/** The child-env additions that point a claude-engine run at GLM. */
export interface GlmEnvAdditions {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  API_TIMEOUT_MS: string;
}

/** Pure — the env additions for a resolved key. The provider gate lives with
 * the caller (`providerOf(model) === "glm"`), not here. */
export function glmEnvAdditions(key: string): GlmEnvAdditions {
  return {
    ANTHROPIC_BASE_URL: GLM_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: key,
    API_TIMEOUT_MS: GLM_API_TIMEOUT_MS,
  };
}

/**
 * Resolve the GLM child-env additions for a resolved chat model, or null when
 * the model is not GLM. The one seam for chat-path injection — the batch/agent
 * path (run.ts) does its own because its prompt-logger interaction differs.
 */
export async function glmChatAdditions(params: {
  boxRoot: string;
  /** The resolved model for the run — null/undefined/non-glm means no additions. */
  model: string | null | undefined;
  /** Access-log label for the key resolution. */
  purpose: string;
}): Promise<GlmEnvAdditions | null> {
  if (params.model === null || params.model === undefined || providerOf(params.model) !== "glm") return null;
  return glmEnvAdditions(await resolveGlmKeyOrThrow(params.boxRoot, { purpose: params.purpose }));
}

/** Thrown when a GLM-model run has no usable key. Names the setup commands. */
export class GlmKeyError extends Error {
  readonly refusal: SecretRefusal;

  constructor(refusal: SecretRefusal) {
    super(
      `This run selected a GLM model, but no usable GLM key is available for this box (${refusal.message}) ` +
        `— set one up with \`bbx secrets set ${GLM_SECRET_NAME}\` and grant it with \`bbx secrets grant <box-slug> ${GLM_SECRET_NAME}\`.`,
    );
    this.name = "GlmKeyError";
    this.refusal = refusal;
  }
}

/** How a caller is spending the key — goes verbatim into the access log. */
export interface GlmKeyRead {
  /** Matches `SECRET_PURPOSE_PATTERN` — a short lowercase label. */
  purpose: string;
}

/**
 * Resolve the stored GLM key, or throw {@link GlmKeyError}. Never returns
 * null: callers on a GLM model need the key or need to fail.
 */
export async function resolveGlmKeyOrThrow(boxRoot: string, read: GlmKeyRead): Promise<string> {
  const resolved = await resolveSecret({ boxRoot, name: GLM_SECRET_NAME, purpose: read.purpose, access: "server" });
  if (!resolved.ok) throw new GlmKeyError(resolved.error);
  return resolved.value.value;
}
