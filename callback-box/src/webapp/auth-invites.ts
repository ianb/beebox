/** Persistent, one-time bearer capabilities for creating one member account. */

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
const INVITE_TTL_MS = 15 * 60 * 1_000;
const MAX_LIVE_INVITES = 100;
const LOCK_WAIT_MS = 5_000;

const inviteRecordSchema = z.object({
  tokenHash: z.string().regex(/^[\da-f]{64}$/),
  boxRoot: z.string().min(1),
  email: z.string().min(1).optional(),
  createdBy: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

const inviteStoreSchema = z.object({
  version: z.literal(1),
  invites: z.array(inviteRecordSchema),
});

type InviteRecord = z.infer<typeof inviteRecordSchema>;
type InviteStore = z.infer<typeof inviteStoreSchema>;

export interface AuthInvite {
  boxRoot: string;
  email?: string | undefined;
  createdBy: string;
  expiresAt: number;
}

export interface MintedAuthInvite extends AuthInvite {
  token: string;
}

export type InspectAuthInviteResult =
  | { status: "valid"; invite: AuthInvite }
  | { status: "invalid-or-gone" };

export type ConsumeAuthInviteResult =
  | { status: "consumed"; invite: AuthInvite }
  | { status: "invalid-or-gone" };

export class AuthInviteStoreError extends Error {
  constructor(
    readonly filePath: string,
    options?: { cause: unknown },
  ) {
    super("Invite store is unavailable; refusing the invite operation.", options);
    this.name = "AuthInviteStoreError";
  }
}

export class AuthInviteCapacityError extends Error {
  constructor() {
    super(`Invite store already has ${String(MAX_LIVE_INVITES)} live invites.`);
    this.name = "AuthInviteCapacityError";
  }
}

export function inviteStorePath(): string {
  return `${authFilePath()}.invites.json`;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashesEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(Buffer.from(first), Buffer.from(second));
}

function toInvite(record: InviteRecord): AuthInvite {
  return {
    boxRoot: record.boxRoot,
    ...(record.email === undefined ? {} : { email: record.email }),
    createdBy: record.createdBy,
    expiresAt: record.expiresAt,
  };
}

async function readStore(): Promise<InviteStore | null> {
  const file = inviteStorePath();
  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.lstat(file);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw new AuthInviteStoreError(file, { cause: error });
  }
  if (fileStat.isSymbolicLink()) {
    throw new AuthInviteStoreError(file);
  }
  if ((fileStat.mode & 0o777) !== 0o600) await fs.promises.chmod(file, 0o600);
  try {
    const parsed: unknown = JSON.parse(await fs.promises.readFile(file, "utf-8"));
    const result = inviteStoreSchema.safeParse(parsed);
    if (!result.success) throw result.error;
    return result.data;
  } catch (error) {
    throw new AuthInviteStoreError(file, { cause: error });
  }
}

async function writeStore(store: InviteStore): Promise<void> {
  const validated = inviteStoreSchema.parse(store);
  await writeFileAtomic(inviteStorePath(), {
    content: `${JSON.stringify(validated, null, 2)}\n`,
    mode: 0o600,
  });
}

function liveInvites(store: InviteStore | null, now: number): InviteRecord[] {
  return (store?.invites ?? []).filter((invite) => invite.expiresAt > now);
}

async function withInviteLock<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const file = inviteStorePath();
  const lockPath = requestScopedLock(`${file}.lock`);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  return withCardLock(file, () =>
    withFileLock({ lockPath, metadata: { purpose: `auth-invite-${operation}` }, waitMs: LOCK_WAIT_MS }, fn),
  );
}

export async function mintAuthInvite(options: {
  boxRoot: string;
  createdBy: string;
  email?: string | undefined;
  now?: number | undefined;
}): Promise<MintedAuthInvite> {
  const now = options.now ?? Date.now();
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const record: InviteRecord = {
    tokenHash: hashToken(token),
    boxRoot: path.resolve(options.boxRoot),
    ...(options.email === undefined ? {} : { email: canonicalizeEmail(options.email) }),
    createdBy: canonicalizeEmail(options.createdBy),
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
  };
  await withInviteLock("mint", async () => {
    const invites = liveInvites(await readStore(), now);
    if (invites.length >= MAX_LIVE_INVITES) throw new AuthInviteCapacityError();
    await writeStore({ version: 1, invites: [...invites, record] });
  });
  return { token, ...toInvite(record) };
}

export async function inspectAuthInvite(options: {
  token: string;
  now?: number | undefined;
}): Promise<InspectAuthInviteResult> {
  const suppliedHash = hashToken(options.token);
  const now = options.now ?? Date.now();
  const store = await readStore();
  const match = liveInvites(store, now).find((invite) => hashesEqual(invite.tokenHash, suppliedHash));
  return match ? { status: "valid", invite: toInvite(match) } : { status: "invalid-or-gone" };
}

export async function consumeAuthInvite(options: {
  token: string;
  now?: number | undefined;
}): Promise<ConsumeAuthInviteResult> {
  const suppliedHash = hashToken(options.token);
  const now = options.now ?? Date.now();
  return withInviteLock("consume", async () => {
    const store = await readStore();
    const invites = liveInvites(store, now);
    const match = invites.find((invite) => hashesEqual(invite.tokenHash, suppliedHash));
    if (!match) {
      if (store && invites.length !== store.invites.length) await writeStore({ version: 1, invites });
      return { status: "invalid-or-gone" };
    }
    await writeStore({ version: 1, invites: invites.filter((invite) => invite !== match) });
    return { status: "consumed", invite: toInvite(match) };
  });
}
