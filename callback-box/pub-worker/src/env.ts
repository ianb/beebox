import type { AccessConfig } from "./access";

/**
 * The Workers rate-limiting binding surface the submit endpoint uses (Track F).
 * Declared locally as a minimal interface rather than pulled from a global type
 * because the binding is OPTIONAL: it may be absent in the vitest-pool-workers
 * test pool and in a box that hasn't provisioned it. `limit({ key })` returns
 * `{ success }` — `false` means the caller has hit the configured window.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings and vars the Worker runs against (declared in `wrangler.jsonc`). */
export interface Env {
  /**
   * The R2 bucket holding publication CONTENT only: `pubs/<id>/manifest.json`,
   * `pubs/<id>/bundle/<path>`, and `slugs/<slug>` pointers. Laptop-OAuth-written by
   * `cb pub go`, read-only from the Worker's perspective (Track A ⚑ — R2 is
   * strongly consistent, so a revocation tombstone takes effect on the next read).
   * Ingestion data lives in {@link Env.PUB_INGEST} instead — see its doc comment
   * for why the split exists.
   */
  PUB_STORE: R2Bucket;
  /**
   * The R2 bucket holding Worker-WRITTEN ingestion data: `submissions/<id>/...`
   * (Track F) and `access-log/<pub-id>/<id>.json` (Track D). Split from
   * {@link Env.PUB_STORE} (Codex cross-review amendment 1, CRITICAL) so the box's
   * stored connector token can be scoped to this bucket only — R2 tokens scope
   * per-bucket, not per-prefix, so a token with R2 Edit on a single shared bucket
   * could rewrite a manifest's `allowedEmails` or replace published content. With
   * the split, the connector can pull submissions/access-log but can never touch
   * `pubs/`/`slugs/`.
   */
  PUB_INGEST: R2Bucket;
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
  /**
   * Build-stamped Worker version (Track E drift detection): `cb pub setup`
   * injects the content hash of the committed Worker source at deploy time
   * (`--var PUB_WORKER_VERSION:<hash>`), and `GET /__version` echoes it so
   * `cb pub status` can flag drift between committed and deployed code. A
   * static, box-free string — safe to serve unauthenticated. Empty/absent ⇒
   * the Worker was deployed outside `cb pub setup` and reports `unversioned`.
   */
  PUB_WORKER_VERSION: string | undefined;
  /**
   * OPTIONAL per-IP rate limiter for `POST /__submit/` (Track F). Absent in the
   * test pool and in boxes that haven't provisioned it — the submit endpoint
   * skips per-IP limiting when it's `undefined` and leans on the daily cap plus
   * the platform's 100k-req/day backstop. `cb pub setup` (Track E) wires the real
   * binding; `wrangler.jsonc` deliberately omits it so miniflare stays green.
   */
  SUBMIT_RATE_LIMITER?: RateLimiter;
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
