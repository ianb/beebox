import type { AccessConfig } from "./access";

/** Bindings and vars the box server uploads with the Worker (`worker-deployer.ts`). */
export interface Env {
  /**
   * The R2 bucket holding publication content: `pubs/<id>/manifest.json`,
   * `pubs/<id>/releases/<release>/<path>`, `slugs/<slug>` pointers, and
   * `shared-routes/<id>/route.json` markers. Read-only from the Worker's
   * perspective; R2 is strongly consistent, so a disable or revoke takes effect
   * on the next read.
   */
  PUB_STORE: R2Bucket;
  /**
   * Pinned publication id for the isolated site Worker. Both this and
   * {@link Env.HOST_HANDLE} must be configured together; partial/invalid setup
   * fails closed.
   */
  PUB_ID?: string;
  /** Random non-capability Worker identity; checked against the R2 site manifest. */
  HOST_HANDLE?: string;
  /** Explicit shared-host serving mode (`shared-v1`). */
  PUB_WORKER_MODE?: string;
  /** Random box identity used to validate approved shared-route markers. */
  PUB_BOX_HANDLE?: string;
  /** Exact custom hostname this shared Worker may serve. */
  PUB_HOSTNAME?: string;
  /**
   * The Cloudflare Access team domain as a full origin, e.g.
   * `https://myteam.cloudflareaccess.com` — also the token `iss`. Typed as
   * possibly-undefined because an undeclared var genuinely arrives `undefined` at
   * runtime; empty/absent ⇒ account tiers not configured.
   */
  ACCESS_TEAM_DOMAIN: string | undefined;
  /**
   * The Access application `aud` tag account-tier tokens must be scoped to.
   * Same possibly-undefined boundary shape as {@link Env.ACCESS_TEAM_DOMAIN};
   * empty/absent ⇒ account tiers not configured.
   */
  ACCESS_AUD: string | undefined;
  /**
   * Hash of the uploaded Worker bundle. The box server compares it against the
   * packaged bundle to decide whether a pinned or shared Worker needs
   * redeploying; the Worker itself never reads it.
   */
  PUB_WORKER_VERSION: string | undefined;
}

/**
 * The Cloudflare Access config for the account tiers, or `null` when account
 * tiers are not configured (either var absent/empty). A `null` result is the
 * fail-closed signal the Worker uses to 404 account-gated content entirely.
 */
export function accessConfig(env: Env): AccessConfig | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  // `env` is an untrusted boundary: an undeclared var arrives `undefined` despite
  // the `string` type, and a placeholder var arrives `""`. Both mean "not
  // configured", so guard against a nullish/empty value before trusting either.
  if (teamDomain === undefined || teamDomain.length === 0) return null;
  if (aud === undefined || aud.length === 0) return null;
  return { teamDomain, aud };
}
