import * as crypto from "node:crypto";
import { z } from "zod";
import { TokenStore, hashToken, nowIso, randomToken } from "../token-store.js";

const MOBILE_DEVICES_RELATIVE_PATH = ".beebox/mobile-devices.secret.json";
const PAIRING_TOKEN_BYTES = 32;
const DEVICE_TOKEN_BYTES = 32;
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;

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

export interface PairingTicket {
  token: string;
  expiresAt: string;
}

const pendingPairings = new Map<string, PendingPairing>();

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

/** Thrown when the device-store lock can't be acquired within the retry budget.
 *  A mutation fails loudly rather than proceeding unsynchronized. */
class MobileDeviceStoreLockError extends Error {
  constructor(readonly lockPath: string) {
    super(`Could not acquire the mobile device-store lock at ${lockPath} within the retry budget`);
    this.name = "MobileDeviceStoreLockError";
  }
}

/**
 * The mobile device store. Its mechanics (hashed tokens, cross-process locking,
 * `lastUsedAt`, revocation, crash-safe writes) live in `core/token-store.ts`;
 * this instance owns only the mobile FILE and the mobile record shape. The scan
 * upload credential is a sibling instance over a different file, so nothing in
 * this module — and therefore nothing on any mobile auth path — can ever resolve
 * a scan token. See `core/scan/tokens.ts`.
 */
const deviceStore = new TokenStore<MobileDevice>({
  relativePath: MOBILE_DEVICES_RELATIVE_PATH,
  collectionKey: "devices",
  purpose: "mobile-devices",
  // Request-scoped: a short critical section whose callers fail fast (~5 s
  // retry budget), so a crashed holder must clear in seconds, not minutes
  // (prod incident, box-family, 2026-08-01 — see file-lock.ts's module doc).
  lockProfile: "request",
  parseRecord: (value) => {
    const parsed = MobileDeviceSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  },
  unreadableError: ({ storePath, cause }) => new DeviceStoreUnreadableError(storePath, { cause }),
  lockError: ({ lockPath }) => new MobileDeviceStoreLockError(lockPath),
});

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
  return deviceStore.read(boxRoot).map(({ tokenHash: _tokenHash, ...device }) => device);
}

/** Who is asking about devices. `email` is null for a caller that authenticated
 *  as a machine rather than a person (an agent bearer, the browse key on a box
 *  that did not opt in). */
export interface DeviceViewer {
  isOwner: boolean;
  email: string | null;
}

/**
 * May this viewer see and revoke this device?
 *
 * You pair your own phone, so you manage your own phone: a person reaches the
 * devices they paired, and the owner reaches every device on the box. Anything
 * else is somebody else's device and does not exist as far as the caller is
 * concerned.
 *
 * A device with `createdBy: null` belongs to nobody — it was paired before the
 * pairer was recorded — so it stays owner-only. Matching a null `createdBy`
 * against a null `email` would hand every such device to any machine caller.
 */
export function mayManageMobileDevice(
  device: Pick<MobileDevice, "createdBy">,
  viewer: DeviceViewer,
): boolean {
  if (viewer.isOwner) return true;
  return viewer.email !== null && device.createdBy === viewer.email;
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
  await deviceStore.append(boxRoot, device);
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

async function resolveMobileTokenIdentity(
  boxRoot: string,
  token: string | undefined,
): Promise<MobileBearerIdentity | null> {
  const device = await deviceStore.verify(boxRoot, token);
  if (!device) return null;
  return { deviceId: device.id, createdBy: device.createdBy };
}

/**
 * Is this device still paired and unrevoked?
 *
 * A read-only counterpart to `resolveMobileTokenIdentity`, which writes
 * `lastUsedAt` on every call. Used when renewing a `bbx_mobile` cookie: the
 * cookie already proved WHICH device it is (it's signed), so renewal only
 * needs to re-check that the device hasn't been revoked since — and must not
 * pay a store write to do it.
 *
 * This read is lock-free (deliberately, to keep the renewal path
 * filesystem-cheap). A renewal that reads the pre-revoke store concurrently
 * with an in-flight revoke can still mint one more full-TTL cookie; that
 * one-TTL window is the documented revocation bound (see
 * docs/mobile-contract.md § Cookie lifetime and revocation). An unreadable
 * store fails closed here — treat the device as inactive rather than renew.
 */
export function isMobileDeviceActive(boxRoot: string, deviceId: string): boolean {
  let devices: MobileDevice[];
  try {
    devices = deviceStore.read(boxRoot);
  } catch (e) {
    if (e instanceof DeviceStoreUnreadableError) {
      console.warn("[pairing] device store unreadable during renewal check; failing closed:", e);
      return false;
    }
    throw e;
  }
  const device = devices.find((item) => item.id === deviceId);
  return device !== undefined && !device.revokedAt;
}

export async function revokeMobileDevice(boxRoot: string, deviceId: string): Promise<boolean> {
  return deviceStore.revoke(boxRoot, (device) => device.id === deviceId);
}

function pruneExpiredPairings(): void {
  const now = Date.now();
  for (const [tokenHash, pending] of pendingPairings) {
    if (pending.used || pending.expiresAt < now) pendingPairings.delete(tokenHash);
  }
}
