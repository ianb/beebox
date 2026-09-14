/**
 * Why `getGoogleAuth` came back empty, in words a person can act on.
 *
 * `getGoogleAuth` returns `null` for at least four unrelated situations — no
 * box, client credentials this process may not read, no token file where this
 * process looks, and a token record with no refresh token — and every call site
 * printed the same sentence for all of them: "Google auth not configured. Run:
 * bbx google-auth."
 *
 * That sentence is wrong for three of the four, and expensively so. A boxholder
 * reauthorized twice against a grant that was already healthy, because the box
 * agent's shell could not see the token file and the only thing the system said
 * was "not configured, run google-auth" (2026-09-14). Reauthorizing cannot fix a
 * process that is looking in the wrong place, and the message is what sent them
 * there.
 *
 * `resolveSecret` already returns typed refusals carrying, in its own words, "a
 * message written for RELAY: the box agent reads it out to the boxholder" — and
 * `getBoxGoogleClientCreds` drops them on the floor. This recovers that
 * explanation on the failure path only, so no call signature changes and nothing
 * is recomputed on the happy path.
 */

import { existsSync } from "node:fs";

import { resolveSecret } from "../core/secrets/resolve.js";
import { GOOGLE_CLIENT_ID_SECRET_NAME, GOOGLE_CLIENT_SECRET_SECRET_NAME } from "./google-auth.js";
import { centralTokenPath, legacySecretPath, loadGoogleTokens } from "./google-token-store.js";

/** The sentence every caller used to print, kept for the one case it fits. */
const RUN_GOOGLE_AUTH = "Google auth not configured. Run: bbx google-auth";

/**
 * A relay-ready explanation of why Google auth is unavailable for this box, in
 * THIS process. Never throws: an explainer that fails is worse than a vague one.
 */
export async function explainGoogleAuthGap(boxRoot?: string): Promise<string> {
  if (boxRoot === undefined) return "Google auth needs a box; this command ran without one.";
  try {
    for (const name of [GOOGLE_CLIENT_ID_SECRET_NAME, GOOGLE_CLIENT_SECRET_SECRET_NAME]) {
      const resolved = await resolveSecret({ boxRoot, name, purpose: "google-auth-explain", access: "server" });
      if (!resolved.ok) return `Google auth unavailable: ${resolved.error.message}`;
    }
    const central = centralTokenPath();
    const legacy = legacySecretPath(boxRoot);
    const where = central === null
      ? `${legacy} (BBX_GOOGLE_TOKENS_FILE is not set in this process)`
      : `${central} (from BBX_GOOGLE_TOKENS_FILE), or ${legacy}`;
    const tokens = await loadGoogleTokens(boxRoot);
    if (tokens === null) {
      const seen = (central !== null && existsSync(central)) || existsSync(legacy);
      return seen
        // The file is right there and unreadable/unparseable — a machine problem.
        ? `Google auth unavailable: a token file exists but could not be read — looked in ${where}.`
        // The case that cost two reauths: authorizing again writes the token to
        // the SERVICE's path, which this process still will not look at.
        : `Google auth unavailable: no token file where this process looks — ${where}. `
          + "If the services authenticate fine, the grant is healthy and reauthorizing will not help: "
          + "this process is looking somewhere else. Run it with the box service's environment.";
    }
    if (!tokens.refreshToken) {
      return "Google auth unavailable: the token record has no refresh token, so it cannot be renewed. "
        + "This is the one case where `bbx google-auth` is the fix.";
    }
    return RUN_GOOGLE_AUTH;
  } catch (_error) {
    return RUN_GOOGLE_AUTH;
  }
}
