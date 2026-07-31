/**
 * `any-account` view logging (Track D of `docs/plans/publish-pages.md`). Every
 * successful view of an `any-account` publication records *who looked*, so the
 * box can pull "who viewed" alongside submissions (Track F) and keep that log as
 * the long-term record.
 *
 * DEVIATION FROM THE PLAN's LITERAL WORDING: the plan describes appending to a
 * single `access-log/<pub-id>.jsonl` object. We instead write ONE small object
 * per view — `access-log/<pub-id>/<id>.json` — because an append to a shared
 * object is a read-modify-write on R2 (no atomic append), so concurrent views
 * would race and lose entries. Per-entry objects dodge that race entirely and
 * match Track F's per-submission `submissions/<id>/...` layout (principle #8, one
 * pattern). The box's pull step lists the prefix and concatenates.
 *
 * `id` and the clock are injected (principle #10) so a test can assert a
 * deterministic object was written.
 *
 * Written to `PUB_INGEST`, not `PUB_STORE`: the ingestion bucket is what the
 * box's stored connector token is scoped to (Codex cross-review amendment 1), so
 * writing here keeps this data on the credential boundary the connector can
 * actually read.
 */

import type { Env } from "./env";

/** One recorded view of an `any-account` publication. */
interface AccessLogEntry {
  /** ISO-8601 view time, from the Worker clock. */
  ts: string;
  /** The pub-id viewed (redundant with the key prefix, kept for standalone reads). */
  pubId: string;
  /** The Access-verified viewer email. */
  email: string;
}

/**
 * Record one `any-account` view. Writes `access-log/<pubId>/<id>.json`.
 *
 * A logging failure must NOT deny an already-authorized viewer, so a failed R2
 * write is logged and swallowed — the caller still serves the asset. (Losing a
 * view record is a lesser harm than 500-ing a legitimate viewer.)
 */
export async function logAccess({
  env,
  pubId,
  email,
  now,
  newId,
}: {
  env: Env;
  pubId: string;
  email: string;
  now: () => number;
  newId: () => string;
}): Promise<void> {
  const entry: AccessLogEntry = { ts: new Date(now()).toISOString(), pubId, email };
  const key = `access-log/${pubId}/${newId()}.json`;
  try {
    await env.PUB_INGEST.put(key, JSON.stringify(entry));
  } catch (e) {
    console.warn(`pub-worker: failed to write access log ${key}: ${String(e)}`);
  }
}
