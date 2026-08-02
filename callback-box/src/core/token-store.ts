/**
 * Shared mechanics for a box's hashed-bearer-token stores.
 *
 * Extracted from `core/mobile/pairing.ts` (its original home) when the scan
 * upload credential arrived: two credential kinds now need the same on-disk
 * machinery — tokens stored only as SHA-256 hashes, a cross-process
 * `file-lock.ts` guard around every read-modify-write, a `lastUsedAt` stamp on
 * verify, and revocation — but they must live in SEPARATE FILES with SEPARATE
 * store instances.
 *
 * That separation is the whole security property (see
 * `docs/plans/scanner-ingest.md` Track 1 and its review finding 1): every
 * mobile gate reduces identity to a boolean and any valid device bearer can
 * mint a full session cookie, so a "scope" field on one shared store could not
 * be contained. Sharing the *mechanics* while keeping the *stores* disjoint
 * means `resolveMobileRequestAuth` structurally cannot resolve a scan token —
 * it reads a different file through a different `TokenStore`.
 *
 * Why every mutation is locked: a store is written from more than one process.
 * `cb hub` verifies a bearer (stamping `lastUsedAt`) before proxying to the
 * per-box `cb serve` child, which verifies it AGAIN and can also revoke. Two
 * processes racing an unsynchronized read-modify-write is a genuine lost update
 * — a verify started before a revoke can write back the pre-revoke record and
 * silently un-revoke the credential — and two overlapping `writeFileSync`s can
 * tear the file. So mutations run under the cross-process lock and land via
 * temp-file + fsync + atomic rename, exactly as the sibling credential store
 * `webapp/local-users.ts` does. Read-only accessors deliberately skip the lock:
 * a stale-by-one read is harmless.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { acquireLock, releaseLock, requestScopedLock, LockHeldError, type LockProfile } from "../lib/file-lock.js";
import { isRecord } from "../lib/is-record.js";

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

/** The fields every stored credential carries, whatever else it adds. */
export interface TokenRecord {
  tokenHash: string;
  lastUsedAt?: string | undefined;
  revokedAt?: string | undefined;
}

/** What a locked mutation gets: the freshly-read records and a way to persist them. */
export interface TokenStoreMutation<TRecord extends TokenRecord> {
  records: TRecord[];
  /** Persist `records` (temp file + fsync + atomic rename). */
  save: () => void;
}

export interface TokenStoreOptions<TRecord extends TokenRecord> {
  /** Store path relative to the box root, e.g. `.callback-box/scan-tokens.secret.json`. */
  relativePath: string;
  /** Top-level JSON key holding the record array, e.g. `devices`. */
  collectionKey: string;
  /** Lock purpose + log prefix, e.g. `mobile-devices`. */
  purpose: string;
  /**
   * Which stale profile the store's lock uses (see `file-lock.ts`). Every
   * `TokenStore` mutation runs inside an HTTP request's ~5 s retry budget, so
   * this should be `"request"` unless a store is genuinely written outside
   * that path.
   */
  lockProfile: LockProfile;
  /** Parse one on-disk record; return null to drop an entry that fails validation. */
  parseRecord: (value: unknown) => TRecord | null;
  /**
   * Wrap "the store exists but couldn't be read or parsed" in the owning
   * store's own error class, so callers keep a credential-specific
   * `instanceof` to fail closed on.
   */
  unreadableError: (opts: { storePath: string; cause: unknown }) => Error;
  /** Wrap "couldn't take the lock within the retry budget" the same way. */
  lockError: (opts: { lockPath: string }) => Error;
}

/** Base-64url random secret. The plaintext is returned to the minting caller
 *  once and never stored. */
export function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One box-scoped, hashed-token credential store. Construct one module-level
 * instance per credential kind; two instances never share a file, a lock, or a
 * record type.
 */
export class TokenStore<TRecord extends TokenRecord> {
  constructor(private readonly options: TokenStoreOptions<TRecord>) {}

  storePath(boxRoot: string): string {
    return path.join(boxRoot, this.options.relativePath);
  }

  /**
   * Read the store, distinguishing "genuinely empty" (ENOENT / first run → `[]`)
   * from "unreadable" (any other IO error, or unparseable JSON → throws the
   * store's `unreadableError`). Individual records that fail validation are
   * dropped, but a whole-file read/parse failure fails CLOSED so a subsequent
   * write can't clobber a store we couldn't load.
   */
  read(boxRoot: string): TRecord[] {
    const file = this.storePath(boxRoot);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return [];
      throw this.options.unreadableError({ storePath: file, cause: e });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw this.options.unreadableError({ storePath: file, cause: e });
    }
    const collection = isRecord(parsed) ? parsed[this.options.collectionKey] : undefined;
    const rawRecords = Array.isArray(collection) ? collection : [];
    const records: TRecord[] = [];
    for (const value of rawRecords) {
      const record = this.options.parseRecord(value);
      if (record !== null) records.push(record);
    }
    return records;
  }

  /**
   * Run a read-modify-write under the cross-process lock, retrying briefly under
   * contention (each critical section is one small write). The read happens
   * INSIDE the lock, so a concurrent process's committed write is always visible
   * before we mutate — that is what makes revoke-vs-`lastUsedAt` safe.
   */
  async withLock<T>(boxRoot: string, fn: (mutation: TokenStoreMutation<TRecord>) => T): Promise<T> {
    const lockPath = `${this.storePath(boxRoot)}.lock`;
    const lock = this.options.lockProfile === "request" ? requestScopedLock(lockPath) : lockPath;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        await acquireLock(lock, { purpose: this.options.purpose });
      } catch (e) {
        if (e instanceof LockHeldError) {
          await delay(LOCK_RETRY_MS);
          continue;
        }
        throw e;
      }
      try {
        const records = this.read(boxRoot);
        return fn({ records, save: () => this.write(boxRoot, records) });
      } finally {
        await releaseLock(lock);
      }
    }
    throw this.options.lockError({ lockPath });
  }

  /** Append a freshly-minted record under the lock. */
  async append(boxRoot: string, record: TRecord): Promise<void> {
    await this.withLock(boxRoot, ({ records, save }) => {
      records.push(record);
      save();
    });
  }

  /**
   * Revoke the first record `matches` selects. Returns false when there is no
   * such record or it was already revoked, so a caller can answer "not found"
   * distinctly from "revoked now".
   */
  async revoke(boxRoot: string, matches: (record: TRecord) => boolean): Promise<boolean> {
    return this.withLock(boxRoot, ({ records, save }) => {
      const record = records.find(matches);
      if (!record || record.revokedAt) return false;
      record.revokedAt = nowIso();
      save();
      return true;
    });
  }

  /**
   * Verify a raw token against this store, returning the matching unrevoked
   * record or null.
   *
   * The `lastUsedAt` stamp makes this a read-modify-write, so it runs under the
   * lock even though most calls are "just checking" — the read happens inside
   * the lock so a credential revoked by another process is always seen here.
   */
  async verify(boxRoot: string, token: string | undefined): Promise<TRecord | null> {
    if (typeof token !== "string" || token.length === 0) return null;
    const suppliedHash = hashToken(token);
    return this.withLock(boxRoot, ({ records, save }) => {
      for (const record of records) {
        if (record.revokedAt) continue;
        if (timingSafeStringEqual(suppliedHash, record.tokenHash)) {
          record.lastUsedAt = nowIso();
          save();
          return record;
        }
      }
      return null;
    });
  }

  /** Crash-safe replace: write a temp sibling (0600), fsync it, atomically
   *  rename over the target, then fsync the directory — a kill mid-write leaves
   *  either the old or the new complete file, never a truncated one. `writeSync`
   *  is looped until the whole buffer lands (a single call may short-write), and
   *  a failure cleans up the temp sibling rather than leaving litter. Call only
   *  inside `withLock`. */
  private write(boxRoot: string, records: TRecord[]): void {
    const file = this.storePath(boxRoot);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    const store = { [this.options.collectionKey]: records };
    const payload = Buffer.from(JSON.stringify(store, null, 2) + "\n", "utf-8");
    try {
      const fd = fs.openSync(tmp, "wx", 0o600);
      try {
        let offset = 0;
        while (offset < payload.length) {
          offset += fs.writeSync(fd, payload, offset, payload.length - offset);
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, file);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch (unlinkErr) {
        if (errnoCode(unlinkErr) !== "ENOENT") {
          console.warn(`[${this.options.purpose}] failed to clean up token-store temp file:`, unlinkErr);
        }
      }
      throw e;
    }
    this.fsyncDir(dir);
  }

  /** fsync a directory so a rename's new dir entry is durable across a crash.
   *  Platforms that can't fsync a directory (e.g. Windows) surface a benign
   *  errno we swallow — the atomic rename is still the tear-safety guarantee. */
  private fsyncDir(dir: string): void {
    let dirFd: number | undefined;
    try {
      dirFd = fs.openSync(dir, "r");
      fs.fsyncSync(dirFd);
    } catch (e) {
      const code = errnoCode(e);
      // EISDIR/EPERM/EINVAL/ENOTSUP: this platform can't fsync a directory
      // handle. The rename remains atomic; only cross-crash durability of the
      // dir entry is weakened, which is acceptable on those platforms. Log
      // anything else.
      if (code !== "EISDIR" && code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP") {
        console.warn(`[${this.options.purpose}] failed to fsync token-store directory:`, e);
      }
    } finally {
      if (dirFd !== undefined) fs.closeSync(dirFd);
    }
  }
}
