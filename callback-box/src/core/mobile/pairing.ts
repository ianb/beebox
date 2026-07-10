import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";

const MOBILE_DEVICES_RELATIVE_PATH = ".callback-box/mobile-devices.secret.json";
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

export interface MobileDevice {
  id: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt?: string | undefined;
  revokedAt?: string | undefined;
}

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

function readDeviceStore(boxRoot: string): MobileDeviceStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(mobileDevicesPath(boxRoot), "utf-8")) as Partial<MobileDeviceStore>;
    return { devices: Array.isArray(parsed.devices) ? parsed.devices.filter(isMobileDevice) : [] };
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("[pairing] failed to read mobile device store:", e);
    }
    return { devices: [] };
  }
}

function writeDeviceStore(boxRoot: string, store: MobileDeviceStore): void {
  const file = mobileDevicesPath(boxRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

function isMobileDevice(value: unknown): value is MobileDevice {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.label === "string"
    && typeof candidate.tokenHash === "string"
    && typeof candidate.createdAt === "string";
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

export function redeemMobilePairingTicket(
  boxRoot: string,
  opts: { pairingToken: string; deviceLabel: string },
): { deviceId: string; deviceToken: string; label: string } | null {
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
  };
  const store = readDeviceStore(boxRoot);
  store.devices.push(device);
  writeDeviceStore(boxRoot, store);
  return { deviceId: device.id, deviceToken, label };
}

export function verifyMobileBearer(boxRoot: string, authorization: string | undefined): boolean {
  if (typeof authorization !== "string") return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  return verifyMobileToken(boxRoot, authorization.slice(prefix.length));
}

export function verifyMobileToken(boxRoot: string, token: string | undefined): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const suppliedHash = hashToken(token);
  const store = readDeviceStore(boxRoot);
  for (const device of store.devices) {
    if (device.revokedAt) continue;
    if (timingSafeStringEqual(suppliedHash, device.tokenHash)) {
      device.lastUsedAt = nowIso();
      writeDeviceStore(boxRoot, store);
      return true;
    }
  }
  return false;
}

export function revokeMobileDevice(boxRoot: string, deviceId: string): boolean {
  const store = readDeviceStore(boxRoot);
  const device = store.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) return false;
  device.revokedAt = nowIso();
  writeDeviceStore(boxRoot, store);
  return true;
}

function pruneExpiredPairings(): void {
  const now = Date.now();
  for (const [tokenHash, pending] of pendingPairings) {
    if (pending.used || pending.expiresAt < now) pendingPairings.delete(tokenHash);
  }
}
