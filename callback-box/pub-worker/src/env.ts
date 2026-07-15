import type { AccessConfig } from "./access";

/** Bindings and vars the Worker runs against (declared in `wrangler.jsonc`). */
export interface Env {
  /**
   * The single R2 bucket holding every publication: `pubs/<id>/manifest.json`,
   * `pubs/<id>/bundle/<path>`, `slugs/<slug>` pointers, and (Tracks D/F)
   * `submissions/<id>/...` + `access-log/<pub-id>/<id>.json` (Track D). One store,
   * one consistency model (Track A ⚑ — R2 is strongly consistent, so a revocation
   * tombstone takes effect on the next read).
   */
  PUB_STORE: R2Bucket;
  /**
   * The Cloudflare Access team domain as a full origin, e.g.
   * `https://myteam.cloudflareaccess.com` — also the token `iss`. Typed as
   * possibly-undefined because an undeclared var genuinely arrives `undefined` at
   * runtime; empty/absent ⇒ account tiers not configured. `cb pub setup` (Track E)
   * fills it.
   */
  ACCESS_TEAM_DOMAIN: string | undefined;
  /**
   * The Access application `aud` tag `/a/` tokens must be scoped to. Same
   * possibly-undefined boundary shape as {@link Env.ACCESS_TEAM_DOMAIN}; empty/absent
   * ⇒ account tiers not configured. `cb pub setup` (Track E) fills it.
   */
  ACCESS_AUD: string | undefined;
}

/**
 * The Cloudflare Access config for the account (`/a/`) tiers, or `null` when
 * account tiers are not configured (either var absent/empty). A `null` result is
 * the fail-closed signal the Worker uses to 404 the `/a/` surface entirely.
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
