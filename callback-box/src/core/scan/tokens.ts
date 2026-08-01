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

const SCAN_TOKENS_RELATIVE_PATH = ".callback-box/scan-tokens.secret.json";
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
});
export type ScanToken = z.infer<typeof ScanTokenSchema>;

/** Thrown when the scan-token store exists but can't be read or parsed. Callers
 *  fail closed: a mutation must NOT overwrite a store it couldn't read. */
export class ScanTokenStoreUnreadableError extends Error {
  constructor(readonly storePath: string, options?: { cause?: unknown }) {
    super(`Scan token store at ${storePath} exists but could not be read or parsed`, options);
    this.name = "ScanTokenStoreUnreadableError";
  }
}

/** Thrown when the scan-token store lock can't be acquired within the retry
 *  budget. A mutation fails loudly rather than proceeding unsynchronized. */
export class ScanTokenStoreLockError extends Error {
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
  }));
}

/** Revoke by name. False when no such token exists or it was already revoked. */
export async function revokeScanToken(boxRoot: string, name: string): Promise<boolean> {
  return scanTokenStore.revoke(boxRoot, (record) => record.name === name);
}

/** Verify a raw token against this box's scan store, stamping `lastUsedAt`. */
export async function verifyScanToken(boxRoot: string, token: string | undefined): Promise<ScanToken | null> {
  return scanTokenStore.verify(boxRoot, token);
}

/** Headers a scan gate needs, in the shape both Fastify and raw Node give. */
export interface ScanAuthHeaders {
  authorization?: string | string[] | undefined;
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
  return verifyScanToken(boxRoot, authorization.slice(prefix.length));
}
