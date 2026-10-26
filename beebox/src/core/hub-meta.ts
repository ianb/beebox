/**
 * The one file a box publishes for the hub: `.beebox/hub-meta.json`.
 *
 * On a unit host the hub runs as its own user, outside every box's group, and
 * reads nothing a box owns except this file: who may open the box
 * (`allowedEmails`, as `_config/box.json` states them), whether a chat
 * schedule is pending (so the hub wakes the box after a reboot), the
 * SHA-256 hashes of the box's agent, mobile-device and scan tokens, so the hub
 * can refuse a junk bearer without waking the box or reading a secret, and
 * the box's display identity (its root landmark's name and symbol) for the
 * hub's box picker (plan question 8). No secret is in it. The box owns it, so
 * a box can only widen or narrow access to itself, which it can already do in
 * `_config/box.json`, and can only misname itself.
 *
 * Written by the engine whenever an input changes: every writer of those
 * files calls `refreshHubMeta`, and `bbx engine serve`, `bbx engine init`
 * and the scheduler pass refresh it too, so a hand edit is caught within a
 * minute on a host that schedules. The landmark card has no single writer (an
 * agent edits it), so the box's own identity read (`landmark/box-identity.ts`,
 * on every page load) republishes when the identity it finds has changed. Modes: the file is 0644, and the box root
 * and `.beebox/` are made 0751 (traversable, not listable) so the hub reaches
 * the file by path and nothing else under them. The rewrite is skipped when
 * nothing but the timestamp would change.
 *
 * Plan: docs/plans/per-box-units.md, Track D.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../lib/atomic-write.js";
import { errnoCode, errorMessage } from "../shared/error-guards.js";
import { isRecord } from "../shared/is-record.js";
import { CardSymbol } from "../shared/card-symbol.js";
import { readPublishedIdentity } from "./landmark/identity-sync.js";
import { AGENT_TOKEN_RELATIVE_PATH, MOBILE_DEVICES_FILE, SCAN_TOKENS_FILE, type TokenFile } from "./token-files.js";

export const HUB_META_RELATIVE_PATH = ".beebox/hub-meta.json";

/**
 * Whether this process reads boxes through their published metadata instead
 * of their own files. Only `bbx engine hub` on a unit host turns it on
 * (`cli/commands/hub.ts`), once, before it serves: the hub user cannot open a
 * box's `_config/box.json` or its credential stores there. A box process
 * never turns it on; the dev router's hub and the tests keep direct reads.
 */
let hubMetaReads = false;
export function enableHubMetaReads(): void { hubMetaReads = true; }
export function hubMetaReadsEnabled(): boolean { return hubMetaReads; }

const hubMetaSchema = z.strictObject({
  allowedEmails: z.array(z.string()),
  pendingSchedules: z.boolean(),
  tokenHashes: z.strictObject({
    agent: z.string().nullable(),
    mobile: z.array(z.string()),
    scan: z.array(z.string()),
  }),
  /** The root landmark's name (null: use the slug) and symbol, for the hub's picker. */
  identity: z.strictObject({ name: z.string().nullable(), symbol: CardSymbol.nullable() }),
  writtenAt: z.string(),
});

export type HubMeta = z.infer<typeof hubMetaSchema>;

export function hubMetaPath(boxRoot: string): string {
  return path.join(boxRoot, HUB_META_RELATIVE_PATH);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** The unrevoked hashes in one `TokenStore` file; a missing file holds none. */
function readTokenHashes(boxRoot: string, file: TokenFile): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(boxRoot, file.relativePath), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  const records = isRecord(parsed) ? parsed[file.collectionKey] : undefined;
  if (!Array.isArray(records)) return [];
  const hashes: string[] = [];
  for (const record of records) {
    if (!isRecord(record) || typeof record["tokenHash"] !== "string") continue;
    if (record["revokedAt"] !== undefined) continue;
    hashes.push(record["tokenHash"]);
  }
  return hashes.toSorted();
}

function readAgentTokenHash(boxRoot: string): string | null {
  try {
    const token = fs.readFileSync(path.join(boxRoot, AGENT_TOKEN_RELATIVE_PATH), "utf8").trim();
    return token === "" ? null : sha256(token);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * Entries in `.beebox/chat-schedules.json`, the file `core/chat/schedules`
 * writes (and whose writer calls `refreshHubMeta`, which is why this does not
 * import its loader). An entry that loader would reject still counts: the
 * safe error is keeping a box up, not letting a check-in go unfired.
 */
function countScheduleEntries(boxRoot: string): number {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(boxRoot, ".beebox", "chat-schedules.json"), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return 0;
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.length : 0;
}

/** `_config/box.json`'s `allowedEmails` as written: the hub canonicalizes, as it does for the box's own copy. */
function readAllowedEmails(boxRoot: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(boxRoot, "_config", "box.json"), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  const emails = isRecord(parsed) ? parsed["allowedEmails"] : undefined;
  return Array.isArray(emails) ? emails.filter((value): value is string => typeof value === "string") : [];
}

/** What the file should say now. Exported for the test; `refreshHubMeta` is the writer. */
export function computeHubMeta(boxRoot: string, now: () => Date): HubMeta {
  return {
    allowedEmails: readAllowedEmails(boxRoot),
    pendingSchedules: countScheduleEntries(boxRoot) > 0,
    tokenHashes: {
      agent: readAgentTokenHash(boxRoot),
      mobile: readTokenHashes(boxRoot, MOBILE_DEVICES_FILE),
      scan: readTokenHashes(boxRoot, SCAN_TOKENS_FILE),
    },
    identity: readPublishedIdentity(boxRoot),
    writtenAt: now().toISOString(),
  };
}

function sameExceptTimestamp(a: HubMeta, b: HubMeta): boolean {
  return JSON.stringify({ ...a, writtenAt: "" }) === JSON.stringify({ ...b, writtenAt: "" });
}

/** Traversable by path, not listable: what the hub needs from the directories above the file. */
const HUB_TRAVERSABLE_MODE = 0o751;

/**
 * Rewrite the file if its content changed. Called by every writer of an input;
 * never throws into the writer's path: a failure here is a warning that names
 * the box, and the hub refuses what it cannot verify.
 */
export function refreshHubMeta(boxRoot: string, options?: { now?: () => Date }): void {
  try {
    writeHubMeta(boxRoot, options?.now ?? (() => new Date()));
  } catch (e) {
    console.warn(`[hub-meta] could not refresh ${hubMetaPath(boxRoot)}: ${errorMessage(e)}`);
  }
}

/** The throwing form, for `bbx engine init` and tests. Returns whether it wrote. */
export function writeHubMeta(boxRoot: string, now: () => Date): boolean {
  const next = computeHubMeta(boxRoot, now);
  let current: HubMeta | undefined;
  try {
    current = readHubMetaFile(boxRoot);
  } catch (e) {
    // A malformed file is replaced, not kept: the rewrite below is its repair.
    console.warn(`[hub-meta] replacing malformed ${hubMetaPath(boxRoot)}: ${errorMessage(e)}`);
  }
  const beeboxDir = path.dirname(hubMetaPath(boxRoot));
  fs.mkdirSync(beeboxDir, { recursive: true });
  fs.chmodSync(boxRoot, HUB_TRAVERSABLE_MODE);
  fs.chmodSync(beeboxDir, HUB_TRAVERSABLE_MODE);
  if (current !== undefined && sameExceptTimestamp(current, next)) return false;
  writeFileAtomicSync(hubMetaPath(boxRoot), { content: `${JSON.stringify(next, null, 2)}\n`, mode: 0o644 });
  // The unit's UMask=0077 masks the mode above to 0600 (found on the VM,
  // 2026-10-24: the hub could not read a fresh box's file); set it outright.
  fs.chmodSync(hubMetaPath(boxRoot), 0o644);
  return true;
}

/** Parse the file; undefined when absent. A malformed file throws: the hub treats that as no metadata and says so. */
function readHubMetaFile(boxRoot: string): HubMeta | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(hubMetaPath(boxRoot), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return undefined;
    throw e;
  }
  return hubMetaSchema.parse(JSON.parse(raw));
}

const READ_CACHE_MS = 1_000;
interface CacheEntry { checkedAt: number; mtimeMs: number | undefined; meta: HubMeta | undefined }
const cache = new Map<string, CacheEntry>();

/**
 * The hub's read: the file as it stands, re-read when its mtime changed and at
 * most once a second per box. Absent or malformed reads as `undefined`, with a
 * warning for malformed, so every gate fails closed.
 */
export function readHubMeta(boxRoot: string, now?: () => number): HubMeta | undefined {
  const at = (now ?? Date.now)();
  const cached = cache.get(boxRoot);
  if (cached !== undefined && at - cached.checkedAt < READ_CACHE_MS) return cached.meta;
  let mtimeMs: number | undefined;
  try {
    mtimeMs = fs.statSync(hubMetaPath(boxRoot)).mtimeMs;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn(`[hub-meta] cannot stat ${hubMetaPath(boxRoot)}: ${errorMessage(e)}`);
    cache.set(boxRoot, { checkedAt: at, mtimeMs: undefined, meta: undefined });
    return undefined;
  }
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    cached.checkedAt = at;
    return cached.meta;
  }
  let meta: HubMeta | undefined;
  try {
    meta = readHubMetaFile(boxRoot);
  } catch (e) {
    console.warn(`[hub-meta] ${hubMetaPath(boxRoot)} is unreadable or malformed; refusing every credential for this box: ${errorMessage(e)}`);
  }
  cache.set(boxRoot, { checkedAt: at, mtimeMs, meta });
  return meta;
}

/** Does `bearer` (an `Authorization` header) match one of `hashes`? Timing-safe on the hash. */
export function bearerMatchesHashes(authorization: string | string[] | undefined, hashes: readonly string[]): boolean {
  if (typeof authorization !== "string") return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  const presented = authorization.slice(prefix.length);
  if (presented.length === 0) return false;
  const presentedHash = Buffer.from(sha256(presented));
  return hashes.some((candidate) => {
    const stored = Buffer.from(candidate);
    return stored.byteLength === presentedHash.byteLength && crypto.timingSafeEqual(stored, presentedHash);
  });
}
