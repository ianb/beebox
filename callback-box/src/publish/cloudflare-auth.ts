/**
 * Cloudflare auth resolution for the publish CLI surface
 * (`docs/plans/pub-setup-wrangler.md` credential model): the env
 * `CLOUDFLARE_API_TOKEN`+`CLOUDFLARE_ACCOUNT_ID` pair wins when present
 * (mirroring wrangler's own precedence), else the interactive `wrangler login`
 * identity. Multi-account logins are never guessed at (amendment 6): a login
 * that can see several accounts must name one via `--account-id` or
 * `CLOUDFLARE_ACCOUNT_ID`, validated against the actual memberships.
 *
 * Pure resolution — no client construction — so it is fully testable against
 * {@link createFakeWrangler} and callers wire whichever clients they need.
 */

import { type BearerProvider, staticBearer, wranglerBearer } from "../services/cloudflare-bearer.js";
import type { WranglerService } from "../services/wrangler.js";
import { LOGIN_INSTRUCTIONS } from "./setup.js";

/** A resolved Cloudflare identity: who to act as, and how to authenticate. */
export interface ResolvedCloudflareAuth {
  kind: "env" | "wrangler";
  accountId: string;
  bearer: BearerProvider;
  /** Extra env for wrangler spawns: the env pair in escape-hatch mode, empty under OAuth. */
  deployEnv: Record<string, string>;
}

export type CloudflareAuthResolution =
  | { ok: true; auth: ResolvedCloudflareAuth }
  | { ok: false; reason: "not-logged-in" | "ambiguous-account" | "unknown-account"; message: string };

/**
 * Resolve the publishing credential. `accountId` is the explicit
 * disambiguation (the `--account-id` flag); the env var covers the same need
 * non-interactively.
 */
export async function resolveCloudflareAuth(
  { accountId }: { accountId?: string | undefined },
  deps: { env?: NodeJS.ProcessEnv | undefined; wrangler: WranglerService },
): Promise<CloudflareAuthResolution> {
  const env = deps.env ?? process.env;
  const envToken = env["CLOUDFLARE_API_TOKEN"];
  const envAccount = env["CLOUDFLARE_ACCOUNT_ID"];
  if (envToken !== undefined && envToken.length > 0 && envAccount !== undefined && envAccount.length > 0) {
    return {
      ok: true,
      auth: {
        kind: "env",
        accountId: envAccount,
        bearer: staticBearer(envToken),
        deployEnv: { CLOUDFLARE_API_TOKEN: envToken, CLOUDFLARE_ACCOUNT_ID: envAccount },
      },
    };
  }

  const identity = await deps.wrangler.whoami();
  if (identity === null) {
    return { ok: false, reason: "not-logged-in", message: LOGIN_INSTRUCTIONS };
  }

  const requested = accountId ?? (envAccount !== undefined && envAccount.length > 0 ? envAccount : undefined);
  if (requested !== undefined) {
    const member = identity.accounts.find((a) => a.id === requested);
    if (member === undefined) {
      const visible = identity.accounts.map((a) => `${a.name} (${a.id})`).join(", ") || "(none)";
      return {
        ok: false,
        reason: "unknown-account",
        message: `account '${requested}' is not among this wrangler login's memberships: ${visible}`,
      };
    }
    return { ok: true, auth: { kind: "wrangler", accountId: member.id, bearer: wranglerBearer(deps.wrangler), deployEnv: {} } };
  }

  const only = identity.accounts.length === 1 ? identity.accounts[0] : undefined;
  if (only === undefined) {
    const visible = identity.accounts.map((a) => `${a.name} (${a.id})`).join(", ") || "(none)";
    return {
      ok: false,
      reason: "ambiguous-account",
      message: `this wrangler login can see ${identity.accounts.length} accounts — pick one with --account-id <id> (or CLOUDFLARE_ACCOUNT_ID): ${visible}`,
    };
  }
  return { ok: true, auth: { kind: "wrangler", accountId: only.id, bearer: wranglerBearer(deps.wrangler), deployEnv: {} } };
}
