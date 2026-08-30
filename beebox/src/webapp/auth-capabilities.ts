/** Persistent, one-time bearer capabilities for account invites and password resets. */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { errnoCode } from "../lib/error-guards.js";
import { requestScopedLock, withFileLock } from "../lib/file-lock.js";
import { withCardLock } from "../lib/card-lock.js";
import { authFilePath, canonicalizeEmail } from "./local-users.js";

const TOKEN_BYTES = 32;
const CAPABILITY_TTL_MS = 15 * 60 * 1_000;
const MAX_LIVE_CAPABILITIES = 100;
const LOCK_WAIT_MS = 5_000;

const recordFields = {
  tokenHash: z.string().regex(/^[\da-f]{64}$/),
  boxRoot: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
};

const legacyInviteRecordSchema = z.object({
  ...recordFields,
  email: z.string().min(1).optional(),
});

const storedCapabilitySchema = z.discriminatedUnion("kind", [
  z.object({
    ...recordFields,
    kind: z.literal("invite"),
    email: z.string().min(1).optional(),
  }),
  z.object({
    ...recordFields,
    kind: z.literal("password-reset"),
    email: z.string().min(1),
  }),
]);

const legacyStoreSchema = z.object({
  version: z.literal(1),
  invites: z.array(legacyInviteRecordSchema),
});

const capabilityStoreSchema = z.object({
  version: z.literal(2),
  capabilities: z.array(storedCapabilitySchema),
});

type StoredCapability = z.infer<typeof storedCapabilitySchema>;
type CapabilityStore = z.infer<typeof capabilityStoreSchema>;
type CapabilityKind = StoredCapability["kind"];

export interface AuthInvite {
  boxRoot: string;
  email?: string | undefined;
  createdBy: string;
  expiresAt: number;
}

export interface MintedAuthInvite extends AuthInvite {
  token: string;
}

export interface AuthPasswordReset {
  boxRoot: string;
  email: string;
  createdBy: string;
  expiresAt: number;
}

export interface MintedAuthPasswordReset extends AuthPasswordReset {
  token: string;
}

export type InspectAuthInviteResult =
  | { status: "valid"; invite: AuthInvite }
  | { status: "invalid-or-gone" };

export type ConsumeAuthInviteResult =
  | { status: "consumed"; invite: AuthInvite }
  | { status: "invalid-or-gone" };

export type InspectAuthPasswordResetResult =
  | { status: "valid"; reset: AuthPasswordReset }
  | { status: "invalid-or-gone" };

export type ConsumeAuthPasswordResetResult =
  | { status: "consumed"; reset: AuthPasswordReset }
  | { status: "invalid-or-gone" };

export class AuthCapabilityStoreError extends Error {
  constructor(
    readonly filePath: string,
    options?: { cause: unknown },
  ) {
    super("Authentication capability store is unavailable; refusing the operation.", options);
    this.name = "AuthCapabilityStoreError";
  }
}

export class AuthCapabilityCapacityError extends Error {
  constructor() {
    super(`Authentication capability store already has ${String(MAX_LIVE_CAPABILITIES)} live records.`);
    this.name = "AuthCapabilityCapacityError";
  }
}

/** Keep the shipped filename so deployment and backup configuration do not move secret state. */
export function authCapabilityStorePath(): string {
  return `${authFilePath()}.invites.json`;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashesEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(Buffer.from(first), Buffer.from(second));
}

function toInvite(record: Extract<StoredCapability, { kind: "invite" }>): AuthInvite {
  return {
    boxRoot: record.boxRoot,
    ...(record.email === undefined ? {} : { email: record.email }),
    createdBy: record.createdBy,
    expiresAt: record.expiresAt,
  };
}

function toPasswordReset(record: Extract<StoredCapability, { kind: "password-reset" }>): AuthPasswordReset {
  return {
    boxRoot: record.boxRoot,
    email: record.email,
    createdBy: record.createdBy,
    expiresAt: record.expiresAt,
  };
}

function parseStore(parsed: unknown): CapabilityStore {
  const current = capabilityStoreSchema.safeParse(parsed);
  if (current.success) return current.data;
  const legacy = legacyStoreSchema.safeParse(parsed);
  if (!legacy.success) throw current.error;
  const capabilities: StoredCapability[] = legacy.data.invites.map((invite) => ({
    ...invite,
    kind: "invite",
  }));
  return {
    version: 2,
    capabilities,
  };
}

async function readStore(): Promise<CapabilityStore | null> {
  const file = authCapabilityStorePath();
  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.lstat(file);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw new AuthCapabilityStoreError(file, { cause: error });
  }
  if (fileStat.isSymbolicLink()) throw new AuthCapabilityStoreError(file);
  if ((fileStat.mode & 0o777) !== 0o600) await fs.promises.chmod(file, 0o600);
  try {
    const parsed: unknown = JSON.parse(await fs.promises.readFile(file, "utf-8"));
    return parseStore(parsed);
  } catch (error) {
    throw new AuthCapabilityStoreError(file, { cause: error });
  }
}

async function writeStore(store: CapabilityStore): Promise<void> {
  const validated = capabilityStoreSchema.parse(store);
  await writeFileAtomic(authCapabilityStorePath(), {
    content: `${JSON.stringify(validated, null, 2)}\n`,
    mode: 0o600,
  });
}

function liveCapabilities(store: CapabilityStore | null, now: number): StoredCapability[] {
  return (store?.capabilities ?? []).filter((capability) => capability.expiresAt > now);
}

async function withCapabilityLock<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const file = authCapabilityStorePath();
  const lockPath = requestScopedLock(`${file}.lock`);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  return withCardLock(file, () =>
    withFileLock({ lockPath, metadata: { purpose: `auth-capability-${operation}` }, waitMs: LOCK_WAIT_MS }, fn),
  );
}

async function mintCapability(record: StoredCapability, now: number): Promise<void> {
  await withCapabilityLock("mint", async () => {
    let capabilities = liveCapabilities(await readStore(), now);
    if (record.kind === "password-reset") {
      capabilities = capabilities.filter(
        (candidate) => candidate.kind !== "password-reset" || candidate.email !== record.email,
      );
    }
    if (capabilities.length >= MAX_LIVE_CAPABILITIES) throw new AuthCapabilityCapacityError();
    await writeStore({ version: 2, capabilities: [...capabilities, record] });
  });
}

export async function mintAuthInvite(options: {
  boxRoot: string;
  createdBy: string;
  email?: string | undefined;
  now?: number | undefined;
}): Promise<MintedAuthInvite> {
  const now = options.now ?? Date.now();
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const record: Extract<StoredCapability, { kind: "invite" }> = {
    kind: "invite",
    tokenHash: hashToken(token),
    boxRoot: path.resolve(options.boxRoot),
    ...(options.email === undefined ? {} : { email: canonicalizeEmail(options.email) }),
    createdBy: canonicalizeEmail(options.createdBy),
    createdAt: now,
    expiresAt: now + CAPABILITY_TTL_MS,
  };
  await mintCapability(record, now);
  return { token, ...toInvite(record) };
}

export async function mintAuthPasswordReset(options: {
  boxRoot: string;
  createdBy: string;
  email: string;
  now?: number | undefined;
}): Promise<MintedAuthPasswordReset> {
  const now = options.now ?? Date.now();
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const record: Extract<StoredCapability, { kind: "password-reset" }> = {
    kind: "password-reset",
    tokenHash: hashToken(token),
    boxRoot: path.resolve(options.boxRoot),
    email: canonicalizeEmail(options.email),
    createdBy: canonicalizeEmail(options.createdBy),
    createdAt: now,
    expiresAt: now + CAPABILITY_TTL_MS,
  };
  await mintCapability(record, now);
  return { token, ...toPasswordReset(record) };
}

async function inspectCapability(options: {
  token: string;
  kind: CapabilityKind;
  now?: number | undefined;
}): Promise<StoredCapability | null> {
  const suppliedHash = hashToken(options.token);
  const now = options.now ?? Date.now();
  const match = liveCapabilities(await readStore(), now).find(
    (capability) => capability.kind === options.kind && hashesEqual(capability.tokenHash, suppliedHash),
  );
  return match ?? null;
}

export async function inspectAuthInvite(options: {
  token: string;
  now?: number | undefined;
}): Promise<InspectAuthInviteResult> {
  const match = await inspectCapability({ ...options, kind: "invite" });
  return match?.kind === "invite" ? { status: "valid", invite: toInvite(match) } : { status: "invalid-or-gone" };
}

export async function inspectAuthPasswordReset(options: {
  token: string;
  now?: number | undefined;
}): Promise<InspectAuthPasswordResetResult> {
  const match = await inspectCapability({ ...options, kind: "password-reset" });
  return match?.kind === "password-reset"
    ? { status: "valid", reset: toPasswordReset(match) }
    : { status: "invalid-or-gone" };
}

async function consumeCapability(options: {
  token: string;
  kind: CapabilityKind;
  now?: number | undefined;
}): Promise<StoredCapability | null> {
  const suppliedHash = hashToken(options.token);
  const now = options.now ?? Date.now();
  return withCapabilityLock("consume", async () => {
    const store = await readStore();
    const capabilities = liveCapabilities(store, now);
    const match = capabilities.find(
      (capability) => capability.kind === options.kind && hashesEqual(capability.tokenHash, suppliedHash),
    );
    if (!match) {
      if (store && capabilities.length !== store.capabilities.length) {
        await writeStore({ version: 2, capabilities });
      }
      return null;
    }
    const remaining = match.kind === "password-reset"
      ? capabilities.filter(
          (capability) => capability.kind !== "password-reset" || capability.email !== match.email,
        )
      : capabilities.filter((capability) => capability !== match);
    await writeStore({ version: 2, capabilities: remaining });
    return match;
  });
}

export async function consumeAuthInvite(options: {
  token: string;
  now?: number | undefined;
}): Promise<ConsumeAuthInviteResult> {
  const match = await consumeCapability({ ...options, kind: "invite" });
  return match?.kind === "invite" ? { status: "consumed", invite: toInvite(match) } : { status: "invalid-or-gone" };
}

export async function consumeAuthPasswordReset(options: {
  token: string;
  now?: number | undefined;
}): Promise<ConsumeAuthPasswordResetResult> {
  const match = await consumeCapability({ ...options, kind: "password-reset" });
  return match?.kind === "password-reset"
    ? { status: "consumed", reset: toPasswordReset(match) }
    : { status: "invalid-or-gone" };
}
