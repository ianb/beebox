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
import { boxSlug } from "../../lib/box-slug.js";
import { errorMessage } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import type { SecretRefusalKind } from "./errors.js";
import { loadSecretStore, mutateSecretStore, secretsLogDir } from "./store.js";

/** Minimum gap between `lastUsed` stamps for one (box, secret) pair. */
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

/** How many distinct observed `purpose` labels one entry keeps. */
const MAX_OBSERVED_PURPOSES = 16;

/**
 * One access-log line.
 *
 * `mint` is the operation-endpoint counterpart of `resolve` (the plan's
 * "operation surface" paragraph): an endpoint that spends a stored key to mint
 * a short-lived derived credential for a browser — `deepgramTempKey`, the
 * OpenAI realtime client secret — never discloses the stored value, so a log
 * that recorded only resolutions would audit the door and ignore the window.
 * Deliberately uncapped (Decision 7): the posture is logged-and-visible, not
 * throttled.
 */
export interface SecretAccessEvent {
  ts: string;
  box: string;
  secret: string;
  purpose: string;
  event: "resolve" | "refuse" | "mint";
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
 * Record that an operation endpoint SPENT a secret to mint a derived credential
 * for a client. The stored value never leaves the server here — what is audited
 * is the act, with the box that asked and what for.
 *
 * Same best-effort contract as the rest of the log: a mint is never blocked by
 * an unwritable log, and never rate-limited (Decision 7).
 */
export async function recordSecretMint(opts: {
  boxRoot: string;
  secret: string;
  purpose: string;
  /** The authoritative slug where one is threaded (`ctx.boxSlug`). */
  slug?: string;
}): Promise<void> {
  const slug = opts.slug ?? (await boxSlug(opts.boxRoot));
  await appendSecretAccessEvent({
    ts: getBoxTimeISO(opts.boxRoot),
    box: slug,
    secret: opts.secret,
    purpose: opts.purpose,
    event: "mint",
  });
}

/**
 * Stamp `lastUsed[slug]` on the entry, at most once an hour — and record the
 * resolve's `purpose` on `purposes` the FIRST time each distinct label is seen.
 *
 * The two have different throttles on purpose. "When was this last used" is a
 * clock reading that only needs to be roughly current, so it is hourly; "what
 * is this used for" is a small set that changes only when a new caller appears,
 * so a purpose that is already recorded costs nothing and a new one is written
 * immediately rather than waiting out the hour (a trick added at 12:05 would
 * otherwise be invisible on the admin page until 13:00, and possibly never — it
 * may only ever run once). Both decisions come from the same lock-free read, so
 * the steady state is still one file read and no lock.
 *
 * {@link MAX_OBSERVED_PURPOSES} bounds the list: an entry resolved under many
 * labels stops collecting rather than growing the store without limit. The
 * access log keeps the full history either way.
 *
 * Best-effort, for the same reason the log is — a store that cannot be written
 * must never fail a transcription.
 */
export async function stampSecretUse(opts: {
  slug: string;
  name: string;
  nowIso: string;
  purpose: string;
}): Promise<void> {
  const { slug, name, nowIso, purpose } = opts;
  try {
    const loaded = await loadSecretStore();
    if (!loaded.ok) return;
    const entry = loaded.value.secrets[name];
    const previous = entry?.lastUsed?.[slug];
    const stampDue = previous === undefined || Date.parse(nowIso) - Date.parse(previous) >= LAST_USED_THROTTLE_MS;
    const observed = entry?.purposes ?? [];
    const purposeIsNew = !observed.includes(purpose) && observed.length < MAX_OBSERVED_PURPOSES;
    if (!stampDue && !purposeIsNew) return;
    await mutateSecretStore({ purpose: "last-used" }, (store) => {
      const current = store.secrets[name];
      if (current === undefined) return;
      if (stampDue) current.lastUsed = { ...current.lastUsed, [slug]: nowIso };
      // Re-checked under the lock: two boxes resolving under the same new label
      // at once both saw it as new, and the loser would otherwise duplicate it.
      const already = current.purposes ?? [];
      if (!already.includes(purpose) && already.length < MAX_OBSERVED_PURPOSES) {
        current.purposes = [...already, purpose].toSorted((a, b) => a.localeCompare(b));
      }
    });
  } catch (e) {
    warnOnce(`could not record last-used for "${name}": ${errorMessage(e)} (resolution proceeded)`);
  }
}
