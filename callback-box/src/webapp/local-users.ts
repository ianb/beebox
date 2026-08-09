/**
 * Local username/password credential store.
 *
 * Owns `~/.cb-auth.json` (override `CB_AUTH_FILE`): the on-disk file that gates
 * every local login. Passwords are stored only as scrypt-derived hashes, never
 * plaintext; the file is `mode 0600`, never a symlink, and Zod-validated on
 * every load (a hand-edited file is an input boundary — principle #3). An
 * unparseable file is a HARD failure of login (`AuthFileCorruptError`), never a
 * silent fall-open (principle #4).
 *
 * Precedent: `src/core/mobile/pairing.ts` (0600 hashed-credential JSON), with
 * scrypt (passwords are low-entropy) and crash-safe writes instead of a plain
 * `writeFileSync`.
 *
 * Concurrency: every mutation, including first-user creation, serializes through
 * the cross-process `file-lock.ts` primitive. Writes use temp-file + fsync +
 * rename so a crash cannot leave a partial JSON file.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../lib/error-guards.js";
import { acquireLock, releaseLock, requestScopedLock, LockHeldError } from "../lib/file-lock.js";
import { currentScryptParams, deriveKey, dummyVerify, hashPassword, type StoredScrypt } from "./local-users-scrypt.js";
import {
  AuthFileCorruptError,
  AuthFileLockError,
  AuthFileSymlinkError,
  LastOwnerRemovalError,
  NoOwnerError,
  NoSuchUserError,
  OwnerEmailMismatchError,
  OwnerExistsError,
  UserExistsError,
} from "./local-users-errors.js";

// --- schema -----------------------------------------------------------------

const scryptRecordSchema = z.object({
  N: z.number().int().positive(),
  r: z.number().int().positive(),
  p: z.number().int().positive(),
  salt: z.string(),
  hash: z.string(),
});

const roleSchema = z.enum(["owner", "member"]);

const userRecordSchema = z.object({
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  gen: z.number().int().positive(),
  scrypt: scryptRecordSchema,
  created: z.string(),
});
type UserRecord = z.infer<typeof userRecordSchema>;

const authFileSchema = z
  .object({
    version: z.literal(1),
    users: z.array(userRecordSchema),
  })
  .refine((f) => f.users.filter((u) => u.role === "owner").length <= 1, {
    message: "auth file must contain at most one owner",
  });
export type AuthFile = z.infer<typeof authFileSchema>;

export type LocalRole = z.infer<typeof roleSchema>;

/** Public view of a user record — never carries the scrypt hash. */
export interface LocalUser {
  email: string;
  name: string;
  role: LocalRole;
  gen: number;
  created: string;
}

// --- paths & helpers --------------------------------------------------------

export function authFilePath(): string {
  return process.env.CB_AUTH_FILE ?? path.join(os.homedir(), ".cb-auth.json");
}

/** Trim + lowercase — the single canonical form compared everywhere. Exported
 *  so the login/setup routes and the throttle key on the SAME canonical form the
 *  store compares against (a case-varying email must not open a separate throttle
 *  bucket or dodge the store's lookup). */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPublic(record: UserRecord): LocalUser {
  return { email: record.email, name: record.name, role: record.role, gen: record.gen, created: record.created };
}

// --- load / write -----------------------------------------------------------

/**
 * Load and validate the auth file. Returns `null` when it doesn't exist yet
 * (the zero-users / first-run state). Throws `AuthFileSymlinkError` /
 * `AuthFileCorruptError` — both `AuthStoreUnavailableError` — otherwise; a bad
 * file NEVER resolves to a silent empty store.
 */
export function loadAuthFile(): AuthFile | null {
  const file = authFilePath();
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw new AuthFileCorruptError(file, { cause: e });
  }
  if (stat.isSymbolicLink()) throw new AuthFileSymlinkError(file);
  if ((stat.mode & 0o777) !== 0o600) {
    console.warn(`[local-users] auth file ${file} has mode ${(stat.mode & 0o777).toString(8)}; tightening to 0600`);
    fs.chmodSync(file, 0o600);
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    throw new AuthFileCorruptError(file, { cause: e });
  }
  const result = authFileSchema.safeParse(json);
  if (!result.success) throw new AuthFileCorruptError(file, { cause: result.error });
  return result.data;
}

function serialize(file: AuthFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function writeAndSync(opts: { path: string; flags: string; data: string }): void {
  const fd = fs.openSync(opts.path, opts.flags, 0o600);
  try {
    fs.writeSync(fd, opts.data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Crash-safe replace: write a temp sibling, fsync, atomically rename over the target. */
function writeAuthFile(file: AuthFile): void {
  const target = authFilePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  writeAndSync({ path: tmp, flags: "w", data: serialize(file) });
  fs.renameSync(tmp, target);
}

// --- cross-process lock -----------------------------------------------------

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a read-modify-write of the auth file under the cross-process lock,
 * retrying briefly under contention (each critical section is a single small
 * write). `null` = the file doesn't exist yet.
 */
async function withAuthFileLock<T>(fn: (file: AuthFile | null) => Promise<T> | T): Promise<T> {
  const lockPath = `${authFilePath()}.lock`;
  // Request-scoped: a short critical section whose callers fail fast (~5 s
  // retry budget), so a crashed holder must clear in seconds, not minutes.
  const lock = requestScopedLock(lockPath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await acquireLock(lock, { purpose: "local-users" });
    } catch (e) {
      if (e instanceof LockHeldError) {
        await delay(LOCK_RETRY_MS);
        continue;
      }
      throw e;
    }
    try {
      return await fn(loadAuthFile());
    } finally {
      await releaseLock(lock);
    }
  }
  throw new AuthFileLockError(lockPath);
}

// --- public API -------------------------------------------------------------

/** The owner's email from the auth file, or `null` when no file exists yet. */
export function getLocalOwnerEmail(): string | null {
  const file = loadAuthFile();
  if (!file) return null;
  const owner = file.users.find((u) => u.role === "owner");
  return owner ? owner.email : null;
}

/** All users (public view — no hashes). Empty when no file exists yet. */
export function listUsers(): LocalUser[] {
  const file = loadAuthFile();
  return file ? file.users.map(toPublic) : [];
}

/** Whether local auth has ever been initialized, including an empty tombstone. */
export function isLocalAuthStoreInitialized(): boolean { return loadAuthFile() !== null; }

/** One user by (canonicalized) email, or `null`. */
export function getLocalUser(email: string): LocalUser | null {
  const file = loadAuthFile();
  return file ? findUser(file, email) : null;
}

/** Find a user in an already-loaded file by canonicalized email (public view). */
export function findUser(file: AuthFile, email: string): LocalUser | null {
  const canonical = canonicalizeEmail(email);
  const record = file.users.find((u) => u.email === canonical);
  return record ? toPublic(record) : null;
}

/**
 * Create the first local owner atomically. A member-only store can already
 * exist when the configured owner uses Google sign-in and invited a member.
 * When `CB_OWNER_EMAIL` is set, the email must match it (canonicalized) —
 * matching, not shadowing, the configured owner.
 */
export async function createFirstUser(opts: {
  email: string;
  name: string;
  password: string;
}): Promise<LocalUser> {
  const email = canonicalizeEmail(opts.email);
  const configured = process.env.CB_OWNER_EMAIL ? canonicalizeEmail(process.env.CB_OWNER_EMAIL) : null;
  if (configured && configured !== email) throw new OwnerEmailMismatchError(configured, email);
  const record: UserRecord = {
    email,
    name: opts.name,
    role: "owner",
    gen: 1,
    scrypt: await hashPassword(opts.password),
    created: nowIso(),
  };
  return withAuthFileLock((file) => {
    if (file?.users.some((user) => user.email === email || user.role === "owner")) {
      throw new UserExistsError(email);
    }
    writeAuthFile({ version: 1, users: file ? [...file.users, record] : [record] });
    return toPublic(record);
  });
}

/** Add a user. A member can initialize a member-only credential store. */
export async function addUser(opts: {
  email: string;
  name: string;
  password: string;
  role: LocalRole;
}): Promise<LocalUser> {
  const scrypt = await hashPassword(opts.password);
  return insertUserWithPasswordHash({ ...opts, scrypt, allowMemberOnlyStore: false });
}

/** Insert a member after its password was hashed outside the store lock. */
export async function addUserWithPasswordHash(opts: {
  email: string;
  name: string;
  role: LocalRole;
  scrypt: StoredScrypt;
}): Promise<LocalUser> {
  return insertUserWithPasswordHash({ ...opts, allowMemberOnlyStore: false });
}

/** Add a member through an owner-issued invite, including the first local user. */
export async function addInvitedMember(opts: { email: string; name: string; password: string }): Promise<LocalUser> {
  const scrypt = await hashPassword(opts.password);
  return addInvitedMemberWithPasswordHash({ email: opts.email, name: opts.name, scrypt });
}

/** Insert an invited member after hashing outside the store lock. */
export async function addInvitedMemberWithPasswordHash(opts: {
  email: string;
  name: string;
  scrypt: StoredScrypt;
}): Promise<LocalUser> {
  return insertUserWithPasswordHash({ ...opts, role: "member", allowMemberOnlyStore: true });
}

async function insertUserWithPasswordHash(opts: {
  email: string;
  name: string;
  role: LocalRole;
  scrypt: StoredScrypt;
  allowMemberOnlyStore: boolean;
}): Promise<LocalUser> {
  const email = canonicalizeEmail(opts.email);
  const { scrypt } = opts;
  return withAuthFileLock((file) => {
    const hasLocalOwner = file?.users.some((user) => user.role === "owner") === true;
    // TODO(env-migration): Read the validated owner setting through src/lib/env.ts.
    const hasConfiguredOwner = Boolean(process.env.CB_OWNER_EMAIL);
    if (!file && !opts.allowMemberOnlyStore) throw new NoOwnerError();
    if (!hasLocalOwner && !hasConfiguredOwner) throw new NoOwnerError();
    if (file?.users.some((u) => u.email === email)) throw new UserExistsError(email);
    if (opts.role === "owner" && file?.users.some((u) => u.role === "owner")) throw new OwnerExistsError(email);
    const record: UserRecord = { email, name: opts.name, role: opts.role, gen: 1, scrypt, created: nowIso() };
    writeAuthFile({ version: 1, users: file ? [...file.users, record] : [record] });
    return toPublic(record);
  });
}

/**
 * Verify a password. Returns the public user on success, `null` on unknown
 * email OR wrong password (uniform — no user enumeration). On success, if the
 * stored parameters differ from the current work factor, the record is
 * transparently rehashed and rewritten (argon2/retuned-N migration path).
 */
export async function verifyPassword(opts: { email: string; password: string }): Promise<LocalUser | null> {
  const email = canonicalizeEmail(opts.email);
  const file = loadAuthFile();
  const record = file?.users.find((u) => u.email === email);
  if (!record) {
    // No record: burn a comparable amount of time before the uniform null so an
    // unknown email can't be distinguished from a known one by response timing.
    await dummyVerify(opts.password);
    return null;
  }

  const stored = Buffer.from(record.scrypt.hash, "base64");
  let derived: Buffer;
  try {
    derived = await deriveKey({
      password: opts.password,
      salt: Buffer.from(record.scrypt.salt, "base64"),
      params: { N: record.scrypt.N, r: record.scrypt.r, p: record.scrypt.p },
    });
  } catch (e) {
    // Bad stored params (hand-edited) or scrypt failure: fail the login closed.
    console.error(`[local-users] scrypt verify failed for ${email}:`, e);
    return null;
  }
  if (stored.length !== derived.length || !crypto.timingSafeEqual(stored, derived)) return null;

  const current = currentScryptParams();
  if (record.scrypt.N !== current.N || record.scrypt.r !== current.r || record.scrypt.p !== current.p) {
    await rehash({ email, password: opts.password });
  }
  return toPublic(record);
}

/** Rewrite a verified user's hash with the current work factor. */
async function rehash(opts: { email: string; password: string }): Promise<void> {
  const scrypt = await hashPassword(opts.password);
  try {
    await withAuthFileLock((file) => {
      if (!file) return;
      const record = file.users.find((u) => u.email === opts.email);
      if (!record) return;
      record.scrypt = scrypt;
      writeAuthFile(file);
    });
  } catch (error) {
    if (!(error instanceof AuthFileLockError)) throw error;
    console.warn(`[local-users] skipped opportunistic password rehash for ${opts.email}: credential store busy`);
  }
}

/** Set a user's password and bump `gen` (revokes every outstanding session). */
export async function setPassword(opts: { email: string; password: string }): Promise<LocalUser> {
  const scrypt = await hashPassword(opts.password);
  return setPasswordWithPasswordHash({ email: opts.email, scrypt });
}

/** Replace a password after hashing outside the credential-store lock. */
export async function setPasswordWithPasswordHash(opts: {
  email: string;
  scrypt: StoredScrypt;
}): Promise<LocalUser> {
  const email = canonicalizeEmail(opts.email);
  return withAuthFileLock((file) => {
    if (!file) throw new NoSuchUserError(email);
    const record = file.users.find((u) => u.email === email);
    if (!record) throw new NoSuchUserError(email);
    record.scrypt = opts.scrypt;
    record.gen += 1;
    writeAuthFile(file);
    return toPublic(record);
  });
}

/** Remove a user. Refuses to remove the owner (`LastOwnerRemovalError`). */
export async function removeUser(opts: { email: string }): Promise<void> {
  const email = canonicalizeEmail(opts.email);
  return withAuthFileLock((file) => {
    if (!file) throw new NoSuchUserError(email);
    const record = file.users.find((u) => u.email === email);
    if (!record) throw new NoSuchUserError(email);
    if (record.role === "owner") throw new LastOwnerRemovalError(email);
    const users = file.users.filter((u) => u.email !== email);
    writeAuthFile({ version: 1, users });
  });
}
