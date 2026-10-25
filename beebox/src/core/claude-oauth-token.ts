/**
 * The box's long-lived Claude Code token: `claude setup-token`, run once by a
 * person with a browser, minted into the machine secret store under
 * `claude-oauth-token` and granted to every box. The Claude CLI accepts it
 * from `CLAUDE_CODE_OAUTH_TOKEN` and then needs no credentials file and no
 * refresh, which is what a host with one Linux user per box needs
 * (`docs/plans/per-box-units.subplan.md`, question 1): a copied
 * `.credentials.json` dies at the first refresh, because the refresh token
 * rotates and the other copies are revoked (measured on production,
 * 2026-10-25).
 *
 * Absent, nothing changes: the CLI reads its login file as before. Present, it
 * reaches every place that runs the CLI as this box — the agent subprocess's
 * environment (`provider-env/core.ts`, first-party runs only; a GLM or
 * OpenRouter run authenticates with its own key) and the `claude auth status`
 * probes behind the preflight, readiness and health checks
 * (`services/claude-cli.ts`), so the probes answer for the same credential the
 * run will use. Precedent for a store-backed env addition: `core/glm-key.ts`.
 */

import { resolveSecret } from "./secrets/resolve.js";

/** The store name the token lives under. */
export const CLAUDE_OAUTH_TOKEN_SECRET = "claude-oauth-token";

/** The variable the Claude CLI and Agent SDK read the token from. */
export const CLAUDE_OAUTH_TOKEN_VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * The env addition carrying this box's token, or none when the box has no
 * usable grant (then the CLI's own login file applies, as before). A refusal
 * is not an error here: the token is one of two ways to be logged in.
 */
export async function claudeOauthTokenEnv(
  boxRoot: string,
  read: { purpose: string; observe: boolean },
): Promise<Record<string, string>> {
  const resolved = await resolveSecret({ boxRoot, name: CLAUDE_OAUTH_TOKEN_SECRET, purpose: read.purpose, access: "server", observe: read.observe });
  return resolved.ok ? { [CLAUDE_OAUTH_TOKEN_VARIABLE]: resolved.value.value } : {};
}
