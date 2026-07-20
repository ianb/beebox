/**
 * One-time `state` nonces for the Google-services connector OAuth flow.
 *
 * The OAuth redirect callback (`webapp/routes/admin.ts`) persists the shared,
 * broadly-scoped Google refresh/access tokens (`CB_GOOGLE_TOKENS_FILE`). It is
 * reachable outside the per-box auth wall (it's registered at server root and,
 * under `cb hub`, proxied like any other request), so on its own the callback
 * cannot tell an owner-initiated grant from a forged one — a credential-swap /
 * token-fixation surface (see
 * `issues/closed/bugs/2026-07-19-google-oauth-callback-unauthenticated.md`).
 *
 * The gate: `googleSetup` (an `ownerProcedure`, so already behind the auth wall)
 * mints a random nonce here BEFORE redirecting to Google, and the callback must
 * present it back. A caller who never passed the owner wall has no valid nonce,
 * so the callback rejects before exchanging any code. The nonce is one-time
 * (consumed on first use) and short-lived, which also closes replay.
 *
 * State is persisted to disk (not just in-memory) because a lazy `cb hub` may
 * idle-collect the box while the owner is on Google's consent screen; the
 * callback cold-starts a fresh process that must still recognize the nonce.
 * The `returnPath` and initiating owner travel in the stored record, never in
 * the (attacker-visible, attacker-settable) URL.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "../core/card-io.js";

const OAUTH_STATE_RELATIVE_PATH = ".callback-box/google-oauth-state.secret.json";
const NONCE_BYTES = 32;
const DEFAULT_STATE_TTL_MS = 15 * 60 * 1000;

const PendingStateSchema = z.object({
  nonceHash: z.string(),
  returnPath: z.string(),
  createdBy: z.string().nullable().default(null),
  createdAt: z.number(),
  expiresAt: z.number(),
});
type PendingState = z.infer<typeof PendingStateSchema>;

interface OAuthStateStore {
  pending: PendingState[];
}

/** Parsed `state` query param: `<boxSlug>:<nonce>` (nonce is base64url — no colons). */
export interface ParsedOAuthState {
  boxSlug: string;
  nonce: string;
}

function statePath(boxRoot: string): string {
  return path.join(boxRoot, OAUTH_STATE_RELATIVE_PATH);
}

function randomNonce(): string {
  return crypto.randomBytes(NONCE_BYTES).toString("base64url");
}

function hashNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function readStore(boxRoot: string): OAuthStateStore {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath(boxRoot), "utf-8"));
    const rawPending = isRecord(parsed) && Array.isArray(parsed.pending) ? parsed.pending : [];
    const pending = rawPending
      .map((p) => PendingStateSchema.safeParse(p))
      .filter((r): r is { success: true; data: PendingState } => r.success)
      .map((r) => r.data);
    return { pending };
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("[google-oauth] failed to read OAuth state store:", e);
    }
    return { pending: [] };
  }
}

function writeStore(boxRoot: string, store: OAuthStateStore): void {
  const file = statePath(boxRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

function prune(pending: PendingState[], now: number): PendingState[] {
  return pending.filter((p) => p.expiresAt > now);
}

/**
 * Parse a callback `state` value into its box slug and nonce. The nonce is
 * base64url (no colons), so the box slug is everything before the first colon.
 * Returns null for a state that carries no nonce (e.g. the legacy
 * `boxSlug`/`boxSlug:returnPath` shapes) — those no longer authorize a grant.
 */
export function parseOAuthState(state: string | undefined): ParsedOAuthState | null {
  if (!state) return null;
  const colonIdx = state.indexOf(":");
  if (colonIdx <= 0) return null;
  const boxSlug = state.slice(0, colonIdx);
  const nonce = state.slice(colonIdx + 1);
  if (!nonce) return null;
  return { boxSlug, nonce };
}

/**
 * Mint a one-time OAuth `state` for a box, persisting the nonce so the callback
 * can verify it. Returns the full `state` string (`<boxSlug>:<nonce>`) to hand
 * to Google's `generateAuthUrl`.
 */
export function createGoogleOAuthState(opts: {
  boxRoot: string;
  boxSlug: string;
  returnPath: string;
  createdBy?: string | null | undefined;
}): string {
  const { boxRoot, boxSlug, returnPath, createdBy } = opts;
  const nonce = randomNonce();
  const now = Date.now();
  const store = readStore(boxRoot);
  const pending = prune(store.pending, now);
  pending.push({
    nonceHash: hashNonce(nonce),
    returnPath,
    createdBy: createdBy ?? null,
    createdAt: now,
    expiresAt: now + DEFAULT_STATE_TTL_MS,
  });
  writeStore(boxRoot, { pending });
  return `${boxSlug}:${nonce}`;
}

/** A consumed OAuth state — the trusted context the callback proceeds with. */
export interface ConsumedOAuthState {
  returnPath: string;
  createdBy: string | null;
}

/**
 * Verify and CONSUME a callback's nonce. Returns the stored record (one time
 * only) if the nonce is known and unexpired, else null. A null result means the
 * callback must reject — no owner ever initiated this grant.
 */
export function consumeGoogleOAuthState(opts: {
  boxRoot: string;
  nonce: string;
}): ConsumedOAuthState | null {
  const { boxRoot, nonce } = opts;
  if (!nonce) return null;
  const now = Date.now();
  const suppliedHash = hashNonce(nonce);
  const store = readStore(boxRoot);
  const live = prune(store.pending, now);
  const match = live.find((p) => timingSafeStringEqual(p.nonceHash, suppliedHash));
  // Rewrite the store minus this nonce (and any expired ones) regardless of a
  // hit, so a match is single-use and pruning stays bounded.
  const remaining = live.filter((p) => p !== match);
  if (remaining.length !== store.pending.length) {
    writeStore(boxRoot, { pending: remaining });
  }
  if (!match) return null;
  return { returnPath: match.returnPath, createdBy: match.createdBy };
}
