/**
 * Scan upload tokens: a per-box, revocable credential whose ONLY privilege is
 * the `/api/scan/…` upload routes.
 *
 * A dedicated store, not a scope field on the mobile device store. Every mobile
 * gate reduces identity to a boolean, and any valid device bearer can mint a
 * scope-less session cookie via `/api/pairing/session` — so a scoped device
 * token could not be contained (cross-model review finding 1, see
 * `docs/plans/scanner-ingest.review.md`). Keeping scan tokens in their own file
 * behind their own `TokenStore` instance makes the isolation structural:
 * `resolveMobileRequestAuth` reads a different file and can never resolve one of
 * these, and no code outside the scan routes reads this store.
 *
 * The mechanics (hashed storage, cross-process locking, `lastUsedAt`,
 * revocation, crash-safe writes) are shared with the mobile store via
 * `core/token-store.ts` — shared code, separate stores.
 */

import { z } from "zod";
import { TokenStore, hashToken, nowIso, randomToken } from "../token-store.js";

const SCAN_TOKENS_RELATIVE_PATH = ".beebox/scan-tokens.secret.json";
const SCAN_TOKEN_BYTES = 32;

/**
 * Token names are the revocation handle AND travel into card provenance as
 * `scan-upload/<name>`, so they stay to a conservative charset — no slashes,
 * whitespace-collapsing, or control characters that could reshape a provenance
 * string downstream.
 */
export const SCAN_TOKEN_NAME_PATTERN = /^[\dA-Za-z][\w.-]{0,63}$/;

const ScanTokenSchema = z.object({
  name: z.string(),
  tokenHash: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable().default(null),
  lastUsedAt: z.string().optional(),
  revokedAt: z.string().optional(),
  // What the uploader said it was, last time it called. All optional and all
  // absent on records written before this existed, and on any uploader too old
  // to send them — which is why the freshness check treats "not reported" as
  // "no opinion" rather than as a stale uploader.
  //
  // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
  lastClientContract: z.string().optional(),
  lastClientBuild: z.string().optional(),
  lastClientBuiltAt: z.string().optional(),
});
export type ScanToken = z.infer<typeof ScanTokenSchema>;

/** Thrown when the scan-token store exists but can't be read or parsed. Callers
 *  fail closed: a mutation must NOT overwrite a store it couldn't read. */
class ScanTokenStoreUnreadableError extends Error {
  constructor(readonly storePath: string, options?: { cause?: unknown }) {
    super(`Scan token store at ${storePath} exists but could not be read or parsed`, options);
    this.name = "ScanTokenStoreUnreadableError";
  }
}

/** Thrown when the scan-token store lock can't be acquired within the retry
 *  budget. A mutation fails loudly rather than proceeding unsynchronized. */
class ScanTokenStoreLockError extends Error {
  constructor(readonly lockPath: string) {
    super(`Could not acquire the scan-token store lock at ${lockPath} within the retry budget`);
    this.name = "ScanTokenStoreLockError";
  }
}

/** Thrown when minting would reuse a name that already identifies a token —
 *  names are the revoke handle, so duplicates would make revocation ambiguous. */
export class DuplicateScanTokenNameError extends Error {
  constructor(readonly tokenName: string) {
    super(`A scan token named ${JSON.stringify(tokenName)} already exists in this box`);
    this.name = "DuplicateScanTokenNameError";
  }
}

/** Thrown when a requested token name is outside `SCAN_TOKEN_NAME_PATTERN`. */
export class InvalidScanTokenNameError extends Error {
  constructor(readonly tokenName: string) {
    super(
      `Scan token name ${JSON.stringify(tokenName)} is invalid: use 1-64 characters of ` +
        "letters, digits, dot, dash or underscore, starting with a letter or digit",
    );
    this.name = "InvalidScanTokenNameError";
  }
}

const scanTokenStore = new TokenStore<ScanToken>({
  relativePath: SCAN_TOKENS_RELATIVE_PATH,
  collectionKey: "tokens",
  purpose: "scan-tokens",
  // Same rationale as the mobile device store (core/mobile/pairing.ts): every
  // mutation runs inside an HTTP request's ~5 s retry budget.
  lockProfile: "request",
  parseRecord: (value) => {
    const parsed = ScanTokenSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  },
  unreadableError: ({ storePath, cause }) => new ScanTokenStoreUnreadableError(storePath, { cause }),
  lockError: ({ lockPath }) => new ScanTokenStoreLockError(lockPath),
});

/** What `list` exposes: never a secret, never a hash. */
export interface ScanTokenSummary {
  name: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  /** How the uploader identified itself on its last request, or null if it has
   * not called since this was recorded. `build` is `"source"` for a checkout,
   * which cannot drift, or a git revision for a copied bundle. */
  lastClient: ScanClientIdentity | null;
}

/** The identity an uploader volunteers on every request. Recorded, never acted
 * on at the gate: a box does not refuse an old uploader, it reports one. */
export interface ScanClientIdentity {
  readonly contract: string | null;
  readonly build: string | null;
  readonly builtAt: string | null;
}

/**
 * Mint a scan token. The plaintext secret is returned HERE AND ONLY HERE — the
 * store keeps a SHA-256 hash, so a lost token is re-minted, never recovered.
 */
export async function createScanToken(
  boxRoot: string,
  opts: { name: string; createdBy: string | null },
): Promise<{ name: string; token: string; createdAt: string }> {
  if (!SCAN_TOKEN_NAME_PATTERN.test(opts.name)) throw new InvalidScanTokenNameError(opts.name);
  const token = randomToken(SCAN_TOKEN_BYTES);
  const record: ScanToken = {
    name: opts.name,
    tokenHash: hashToken(token),
    createdAt: nowIso(),
    createdBy: opts.createdBy,
  };
  // The duplicate check runs INSIDE the lock alongside the append, so two
  // concurrent mints of the same name can't both see "no such name".
  await scanTokenStore.withLock(boxRoot, ({ records, save }) => {
    if (records.some((existing) => existing.name === opts.name)) {
      throw new DuplicateScanTokenNameError(opts.name);
    }
    records.push(record);
    save();
  });
  return { name: record.name, token, createdAt: record.createdAt };
}

export function listScanTokens(boxRoot: string): ScanTokenSummary[] {
  return scanTokenStore.read(boxRoot).map((record) => ({
    name: record.name,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    lastUsedAt: record.lastUsedAt ?? null,
    revoked: record.revokedAt !== undefined,
    lastClient: identityOf(record),
  }));
}

/** `null` when the uploader has reported nothing at all — an uploader too old
 * to send the headers, or a token minted but never used. Distinguishing that
 * from a reported value is what keeps the freshness check from calling every
 * pre-existing uploader stale. */
function identityOf(record: ScanToken): ScanClientIdentity | null {
  const contract = record.lastClientContract ?? null;
  const build = record.lastClientBuild ?? null;
  const builtAt = record.lastClientBuiltAt ?? null;
  if (contract === null && build === null && builtAt === null) return null;
  return { contract, build, builtAt };
}

/** Revoke by name. False when no such token exists or it was already revoked. */
export async function revokeScanToken(boxRoot: string, name: string): Promise<boolean> {
  return scanTokenStore.revoke(boxRoot, (record) => record.name === name);
}

/** Verify a raw token against this box's scan store, stamping `lastUsedAt`.
 * The request path uses `resolveScanRequestAuth` instead, which also records
 * what the uploader said it was. */
export async function verifyScanToken(boxRoot: string, token: string | undefined): Promise<ScanToken | null> {
  return scanTokenStore.verify(boxRoot, { token });
}

/**
 * Stamps what the uploader said it was onto the record, on the write
 * `lastUsedAt` already performs.
 *
 * Runs on EVERY scan request, including one that reported nothing, and in that
 * case clears the fields. A token can be used by more than one uploader — a
 * second laptop, or the same laptop after an older bundle is copied over the
 * newer one — and leaving the previous identity in place would report the
 * newer uploader's build for a request made by an older one, which is the
 * stale-uploader question answered backwards.
 *
 * Values are capped rather than validated: they are untrusted client strings
 * whose only use is being shown to a person, so a nonsense value must be
 * harmless, not fatal.
 */
function stampIdentity(record: ScanToken, identity: ScanClientIdentity | undefined): void {
  record.lastClientContract = capIdentity(identity?.contract ?? null);
  record.lastClientBuild = capIdentity(identity?.build ?? null);
  record.lastClientBuiltAt = capIdentity(identity?.builtAt ?? null);
}

/** Untrusted header text, kept short enough that a hostile or broken client
 * cannot bloat the credential store. Absent stays absent rather than becoming
 * an empty string, so "not reported" and "reported as nothing" stay distinct. */
const MAX_IDENTITY_LENGTH = 100;

function capIdentity(value: string | null): string | undefined {
  if (value === null || value === "") return undefined;
  return value.slice(0, MAX_IDENTITY_LENGTH);
}

/** Headers a scan gate needs, in the shape both Fastify and raw Node give.
 *
 * The three `x-scan-client-*`/`x-scan-contract` headers are what the uploader
 * volunteers about itself. They are NOT a credential and never gate anything;
 * they are recorded so a person can see that an uploader is old.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
export interface ScanAuthHeaders {
  authorization?: string | string[] | undefined;
  "x-scan-contract"?: string | string[] | undefined;
  "x-scan-client-build"?: string | string[] | undefined;
  "x-scan-client-built-at"?: string | string[] | undefined;
}

/** Repeated headers arrive as arrays; only a single value is meaningful. */
function singleHeader(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** Reads the uploader's self-reported identity off a request, or `undefined`
 * when it reported none — an uploader predating these headers. */
export function readScanClientIdentity(headers: ScanAuthHeaders): ScanClientIdentity | undefined {
  const contract = singleHeader(headers["x-scan-contract"]);
  const build = singleHeader(headers["x-scan-client-build"]);
  const builtAt = singleHeader(headers["x-scan-client-built-at"]);
  if (contract === null && build === null && builtAt === null) return undefined;
  return { contract, build, builtAt };
}

/**
 * Resolve a request's scan-token identity, or null.
 *
 * The single bearer-parsing point shared by the box's scan preHandler
 * (`webapp/scan-auth.ts`) and the hub's scan gate (`hub/hub-server.ts`) — both
 * boundaries verify independently, neither trusts the other.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
export async function resolveScanRequestAuth(boxRoot: string, headers: ScanAuthHeaders): Promise<ScanToken | null> {
  // Node gives repeated headers as arrays; only a single value can be a credential.
  const authorization = typeof headers.authorization === "string" ? headers.authorization : undefined;
  if (authorization === undefined) return null;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return null;
  // Not `verifyScanToken`: this is the request path, so it also records what
  // the uploader said it was — on the same locked write, costing no extra lock.
  const identity = readScanClientIdentity(headers);
  return scanTokenStore.verify(boxRoot, {
    token: authorization.slice(prefix.length),
    onUse: (record) => stampIdentity(record, identity),
  });
}
