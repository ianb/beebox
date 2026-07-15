/** Bindings and vars the Worker runs against (declared in `wrangler.jsonc`). */
export interface Env {
  /**
   * The single R2 bucket holding every publication: `pubs/<id>/manifest.json`,
   * `pubs/<id>/bundle/<path>`, `slugs/<slug>` pointers, and (Tracks D/F)
   * `submissions/<id>/...` + `access-log/<id>.jsonl`. One store, one consistency
   * model (Track A ⚑ — R2 is strongly consistent, so a revocation tombstone
   * takes effect on the next read).
   */
  PUB_STORE: R2Bucket;
  /**
   * `"true"` enables the account (`/a/`) tiers. Off until Track D adds
   * Cloudflare Access JWT validation; while off, account tiers fail closed (404).
   */
  ACCOUNT_TIERS_ENABLED: string;
}

/** Whether the account (`/a/`) tiers are served. Track D removes this seam. */
export function accountTiersEnabled(env: Env): boolean {
  return env.ACCOUNT_TIERS_ENABLED === "true";
}
