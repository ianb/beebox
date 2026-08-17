/**
 * The secret access log: one JSONL line per resolve or refusal, in monthly
 * segments beside the store (`docs/plans/secret-custody.md`, Track 2).
 *
 * What it buys is ATTRIBUTION — which box used which secret, when, for what —
 * not tamper-proof audit. So it is best-effort BY DECLARATION: if the log
 * cannot be written (disk full, a bad mode on the directory), the resolve still
 * proceeds and we warn once per process. Availability of the box wins over
 * completeness of the log; the plan says so in its failure-modes table, and a
 * log that could block a transcription would be a worse trade.
 *
 * Values are NEVER logged — not the secret, not a prefix of it. If a value ever
 * has to appear in diagnostics it gets HMAC'd (Vault's audit-device rule).
 *
 * `lastUsed` on the store entry is the summarized companion: the log answers
 * "what happened", the entry answers "is this still in use", so deleting an old
 * segment never loses the latter. It is stamped at most hourly per (box,
 * secret) — a per-resolve write would put the store's lock in the path of every
 * transcription.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";
import type { SecretRefusalKind } from "./errors.js";
import { loadSecretStore, mutateSecretStore, secretsLogDir } from "./store.js";

/** Minimum gap between `lastUsed` stamps for one (box, secret) pair. */
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

/** One access-log line. */
export interface SecretAccessEvent {
  ts: string;
  box: string;
  secret: string;
  purpose: string;
  event: "resolve" | "refuse";
  refusal?: SecretRefusalKind;
}

let warnedAboutLog = false;

function warnOnce(message: string): void {
  if (warnedAboutLog) return;
  warnedAboutLog = true;
  console.warn(`[secrets] ${message}`);
}

/** Reset the once-per-process warning latch (tests only). */
export function resetSecretLogWarning(): void {
  warnedAboutLog = false;
}

/** The monthly segment a timestamp belongs to, e.g. `…/secrets-log/2026-08.jsonl`. */
export function accessLogSegmentPath(iso: string): string {
  const month = iso.slice(0, 7);
  return path.join(secretsLogDir(), `${month}.jsonl`);
}

/** Append one event. Never throws — a broken log must not break a resolve. */
export async function appendSecretAccessEvent(event: SecretAccessEvent): Promise<void> {
  const segment = accessLogSegmentPath(event.ts);
  try {
    await fs.mkdir(path.dirname(segment), { recursive: true, mode: 0o700 });
    await fs.appendFile(segment, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (e) {
    warnOnce(`access log unwritable at ${segment}: ${errorMessage(e)} (resolution proceeded)`);
  }
}

/**
 * Stamp `lastUsed[slug]` on the entry, at most once an hour. Reads lock-free
 * first so the throttled-away common case costs one file read and no lock;
 * also best-effort, for the same reason the log is.
 */
export async function stampSecretLastUsed(opts: { slug: string; name: string; nowIso: string }): Promise<void> {
  const { slug, name, nowIso } = opts;
  try {
    const loaded = await loadSecretStore();
    if (!loaded.ok) return;
    const previous = loaded.value.secrets[name]?.lastUsed?.[slug];
    if (previous !== undefined && Date.parse(nowIso) - Date.parse(previous) < LAST_USED_THROTTLE_MS) return;
    await mutateSecretStore({ purpose: "last-used" }, (store) => {
      const entry = store.secrets[name];
      if (entry === undefined) return;
      entry.lastUsed = { ...entry.lastUsed, [slug]: nowIso };
    });
  } catch (e) {
    warnOnce(`could not record last-used for "${name}": ${errorMessage(e)} (resolution proceeded)`);
  }
}
