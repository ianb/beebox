import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { isRecord } from "../card-io.js";

const MOBILE_DEVICES_RELATIVE_PATH = ".callback-box/mobile-devices.secret.json";
const PAIRING_TOKEN_BYTES = 32;
const DEVICE_TOKEN_BYTES = 32;
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;

// The device store is written from more than one process: `cb hub` verifies a
// mobile bearer (stamping `lastUsedAt`) before proxying to the per-box `cb serve`
// child, which verifies it AGAIN and can also revoke a device. Two processes
// racing an unsynchronized read-modify-write is a genuine lost update — a
// bearer verify started before a revoke can write back the pre-revoke record and
// silently un-revoke the device — and two overlapping `writeFileSync`s can tear
// the file. Every mutation therefore runs through the cross-process
// `file-lock.ts` primitive (crash + sleep aware) and lands via temp-file + fsync
// + atomic rename, exactly as the sibling credential store `webapp/local-users.ts`
// does. Read-only accessors (`listMobileDevices`, `isMobileDeviceActive`) don't
// take the lock — a stale-by-one read is harmless — and pairing-ticket creation
// touches only the in-memory pending map.
const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

interface PendingPairing {
  boxRoot: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string | null;
  used: boolean;
}

const MobileDeviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  tokenHash: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable().default(null),
  lastUsedAt: z.string().optional(),
  revokedAt: z.string().optional(),
});
export type MobileDevice = z.infer<typeof MobileDeviceSchema>;

interface MobileDeviceStore {
  devices: MobileDevice[];
}

export interface PairingTicket {
  token: string;
  expiresAt: string;
}

const pendingPairings = new Map<string, PendingPairing>();

function mobileDevicesPath(boxRoot: string): string {
  return path.join(boxRoot, MOBILE_DEVICES_RELATIVE_PATH);
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Thrown when the device store exists but can't be read or parsed. Callers
 *  fail closed on it — a mutation must NOT overwrite a store it couldn't read
 *  (that would silently drop every device it failed to load), and a renewal
 *  check treats "unreadable" as "not active". Distinct from a genuinely-absent
 *  store (ENOENT → empty), which is the legitimate first-run case. */
export class DeviceStoreUnreadableError extends Error {
  constructor(readonly storePath: string, options?: { cause?: unknown }) {
    super(`Mobile device store at ${storePath} exists but could not be read or parsed`, options);
    this.name = "DeviceStoreUnreadableError";
  }
}

/**
 * Read the device store, distinguishing "genuinely empty" (ENOENT / first run →
 * `{ devices: [] }`) from "unreadable" (any other IO error, or unparseable
 * JSON → throws `DeviceStoreUnreadableError`). Individual devices that fail
 * schema validation are dropped, but a whole-file read/parse failure fails
 * closed so a subsequent write can't clobber a store we couldn't load.
 */
function readDeviceStore(boxRoot: string): MobileDeviceStore {
  const file = mobileDevicesPath(boxRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { devices: [] };
    throw new DeviceStoreUnreadableError(file, { cause: e });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new DeviceStoreUnreadableError(file, { cause: e });
  }
  const rawDevices = isRecord(parsed) && Array.isArray(parsed.devices) ? parsed.devices : [];
  const devices = rawDevices
    .map((d) => MobileDeviceSchema.safeParse(d))
    .filter((r) => r.success)
    .map((r) => r.data);
  return { devices };
}

/** fsync a directory so a rename's new dir entry is durable across a crash.
 *  Platforms that can't fsync a directory (e.g. Windows) surface a benign errno
 *  we swallow — the atomic rename is still the tear-safety guarantee. */
function fsyncDir(dir: string): void {
  let dirFd: number | undefined;
  try {
    dirFd = fs.openSync(dir, "r");
    fs.fsyncSync(dirFd);
  } catch (e) {
    const code = errnoCode(e);
    // EISDIR/EPERM/EINVAL/ENOTSUP: this platform can't fsync a directory handle.
    // The rename remains atomic; only cross-crash durability of the dir entry is
    // weakened, which is acceptable on those platforms. Log anything else.
    if (code !== "EISDIR" && code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP") {
      console.warn("[pairing] failed to fsync device-store directory:", e);
    }
  } finally {
    if (dirFd !== undefined) fs.closeSync(dirFd);
  }
}

/** Crash-safe replace: write a temp sibling (0600), fsync it, atomically rename
 *  over the target, then fsync the directory — a kill mid-write leaves either
 *  the old or the new complete file, never a truncated one. `writeSync` is
 *  looped until the whole buffer lands (a single call may short-write), and a
 *  failure cleans up the temp sibling rather than leaving litter. Call only
 *  inside `withDeviceStoreLock`. */
function writeDeviceStore(boxRoot: string, store: MobileDeviceStore): void {
  const file = mobileDevicesPath(boxRoot);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
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
        console.warn("[pairing] failed to clean up device-store temp file:", unlinkErr);
      }
    }
    throw e;
  }
  fsyncDir(dir);
}

/** Thrown when the device-store lock can't be acquired within the retry budget
 *  (`LOCK_RETRIES` × `LOCK_RETRY_MS`). A mutation fails loudly rather than
 *  proceeding unsynchronized. */
export class MobileDeviceStoreLockError extends Error {
  constructor(readonly lockPath: string) {
    super(`Could not acquire the mobile device-store lock at ${lockPath} within the retry budget`);
    this.name = "MobileDeviceStoreLockError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a read-modify-write of the device store under the cross-process lock,
 * retrying briefly under contention (each critical section is one small write).
 * `fn` receives the freshly-read store and mutates + `writeDeviceStore`s it; the
 * read happens INSIDE the lock so a concurrent process's committed write is
 * always visible before we mutate, which is what makes the revoke-vs-lastUsedAt
 * update safe.
 */
async function withDeviceStoreLock<T>(
  boxRoot: string,
  fn: (store: MobileDeviceStore) => T,
): Promise<T> {
  const lockPath = `${mobileDevicesPath(boxRoot)}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await acquireLock(lockPath, { purpose: "mobile-devices" });
    } catch (e) {
      if (e instanceof LockHeldError) {
        await delay(LOCK_RETRY_MS);
        continue;
      }
      throw e;
    }
    try {
      return fn(readDeviceStore(boxRoot));
    } finally {
      await releaseLock(lockPath);
    }
  }
  throw new MobileDeviceStoreLockError(lockPath);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createMobilePairingTicket(
  boxRoot: string,
  opts?: { createdBy?: string | null | undefined; ttlMs?: number | undefined },
): PairingTicket {
  const resolvedOpts = opts ?? {};
  const token = randomToken(PAIRING_TOKEN_BYTES);
  const createdAt = Date.now();
  const expiresAt = createdAt + (resolvedOpts.ttlMs ?? DEFAULT_PAIRING_TTL_MS);
  const tokenHash = hashToken(token);
  pendingPairings.set(tokenHash, {
    boxRoot,
    tokenHash,
    createdAt,
    expiresAt,
    createdBy: resolvedOpts.createdBy ?? null,
    used: false,
  });
  pruneExpiredPairings();
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function listMobileDevices(boxRoot: string): Array<Omit<MobileDevice, "tokenHash">> {
  return readDeviceStore(boxRoot).devices.map(({ tokenHash: _tokenHash, ...device }) => device);
}

export async function redeemMobilePairingTicket(
  boxRoot: string,
  opts: { pairingToken: string; deviceLabel: string },
): Promise<{ deviceId: string; deviceToken: string; label: string } | null> {
  pruneExpiredPairings();
  const tokenHash = hashToken(opts.pairingToken);
  const pending = pendingPairings.get(tokenHash);
  if (!pending || pending.used || pending.expiresAt < Date.now() || pending.boxRoot !== boxRoot) {
    return null;
  }

  pending.used = true;
  pendingPairings.delete(tokenHash);

  const deviceToken = randomToken(DEVICE_TOKEN_BYTES);
  const label = opts.deviceLabel.trim() || "iOS companion";
  const device: MobileDevice = {
    id: crypto.randomUUID(),
    label,
    tokenHash: hashToken(deviceToken),
    createdAt: nowIso(),
    createdBy: pending.createdBy,
  };
  await withDeviceStoreLock(boxRoot, (store) => {
    store.devices.push(device);
    writeDeviceStore(boxRoot, store);
  });
  return { deviceId: device.id, deviceToken, label };
}

export interface MobileBearerIdentity {
  deviceId: string;
  createdBy: string | null;
}

export async function resolveMobileBearerIdentity(
  boxRoot: string,
  authorization: string | undefined,
): Promise<MobileBearerIdentity | null> {
  if (typeof authorization !== "string") return null;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return null;
  return resolveMobileTokenIdentity(boxRoot, authorization.slice(prefix.length));
}

export async function verifyMobileBearer(boxRoot: string, authorization: string | undefined): Promise<boolean> {
  return (await resolveMobileBearerIdentity(boxRoot, authorization)) !== null;
}

export async function verifyMobileToken(boxRoot: string, token: string | undefined): Promise<boolean> {
  return (await resolveMobileTokenIdentity(boxRoot, token)) !== null;
}

async function resolveMobileTokenIdentity(
  boxRoot: string,
  token: string | undefined,
): Promise<MobileBearerIdentity | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  const suppliedHash = hashToken(token);
  // The lastUsedAt stamp makes this a read-modify-write, so it runs under the
  // lock even though most calls are "just checking" — the read happens inside
  // the lock so a device revoked by another process is always seen here.
  return withDeviceStoreLock(boxRoot, (store) => {
    for (const device of store.devices) {
      if (device.revokedAt) continue;
      if (timingSafeStringEqual(suppliedHash, device.tokenHash)) {
        device.lastUsedAt = nowIso();
        writeDeviceStore(boxRoot, store);
        return { deviceId: device.id, createdBy: device.createdBy };
      }
    }
    return null;
  });
}

/**
 * Is this device still paired and unrevoked?
 *
 * A read-only counterpart to `resolveMobileTokenIdentity`, which writes
 * `lastUsedAt` on every call. Used when renewing a `cb_mobile` cookie: the
 * cookie already proved WHICH device it is (it's signed), so renewal only
 * needs to re-check that the device hasn't been revoked since — and must not
 * pay a store write to do it.
 *
 * This read is lock-free and outside `withDeviceStoreLock` (deliberately, to
 * keep the renewal path filesystem-cheap). A renewal that reads the pre-revoke
 * store concurrently with an in-flight revoke can still mint one more full-TTL
 * cookie; that one-TTL window is the documented revocation bound (see
 * docs/mobile-contract.md § Cookie lifetime and revocation). An unreadable
 * store fails closed here — treat the device as inactive rather than renew.
 */
export function isMobileDeviceActive(boxRoot: string, deviceId: string): boolean {
  let store: MobileDeviceStore;
  try {
    store = readDeviceStore(boxRoot);
  } catch (e) {
    if (e instanceof DeviceStoreUnreadableError) {
      console.warn("[pairing] device store unreadable during renewal check; failing closed:", e);
      return false;
    }
    throw e;
  }
  const device = store.devices.find((item) => item.id === deviceId);
  return device !== undefined && !device.revokedAt;
}

export async function revokeMobileDevice(boxRoot: string, deviceId: string): Promise<boolean> {
  return withDeviceStoreLock(boxRoot, (store) => {
    const device = store.devices.find((item) => item.id === deviceId);
    if (!device || device.revokedAt) return false;
    device.revokedAt = nowIso();
    writeDeviceStore(boxRoot, store);
    return true;
  });
}

function pruneExpiredPairings(): void {
  const now = Date.now();
  for (const [tokenHash, pending] of pendingPairings) {
    if (pending.used || pending.expiresAt < now) pendingPairings.delete(tokenHash);
  }
}
