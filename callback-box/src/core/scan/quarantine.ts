/**
 * Scan-upload quarantine: `tmp/scan-quarantine/` inside the box.
 *
 * Every file the scan routes accept lands here as `<sha256>.<ext>` beside a
 * sidecar `<sha256>.json` carrying the entry's durable state machine. The
 * sidecar — not memory, not a database — is the recovery source of truth: the
 * promote worker (Track 2 chunk 2) re-scans this directory at startup and
 * resumes whatever it finds, so a crash mid-promote is recoverable and the
 * `check` route can answer for a hash without the uploader's help.
 *
 * States: `pending` (validated, awaiting promote) and `rejected` (failed
 * validation, held for the boxholder-facing question card) are written by the
 * PUT route; `promoting` and `imported` are the promote worker's. They are all
 * declared here so the shape is settled once rather than migrated later.
 *
 * The generic `tmp/` sweep (`core/housekeeping.ts`) skips directories, so
 * nothing else cleans this up — quarantine GC belongs to the promote worker.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { boxTmpDir } from "../../lib/box-tmp.js";
import { errnoCode } from "../../lib/error-guards.js";
import { withCardLock } from "../../lib/card-lock.js";

const QUARANTINE_DIR_NAME = "scan-quarantine";

/** The sidecar state machine. `pending`/`rejected` are written by the upload
 *  route; `promoting`/`imported` by the promote worker. */
export const SCAN_QUARANTINE_STATES = ["pending", "promoting", "imported", "rejected"] as const;

const ScanQuarantineEntrySchema = z.object({
  /** SHA-256 of the stored bytes, lowercase hex — the entry's identity. */
  sha256: z.string(),
  state: z.enum(SCAN_QUARANTINE_STATES),
  /** Name of the file beside this sidecar (`<sha256>.<ext>`). */
  storedFilename: z.string(),
  /** Sanitized basename the uploader claimed — the promote worker materializes
   *  the file under THIS name, because scan-import's grouping keys on it. */
  originalFilename: z.string(),
  /** Scan token that uploaded it, or null for an owner-driven request. */
  tokenName: z.string().nullable(),
  /** Free-text scanner profile (`X-Scan-Profile`), when the uploader sent one. */
  profile: z.string().optional(),
  receivedAt: z.string(),
  /** Human-readable rejection reason — `rejected` entries only. */
  reason: z.string().optional(),
  /** Ref of the question card raised for a rejection; makes emission idempotent
   *  across repeated promote passes. Written by the promote worker. */
  questionRef: z.string().optional(),
  /** When the rejection's question card was seen resolved. Set by the promote
   *  worker's GC, which deletes the stored bytes at that moment and leaves the
   *  sidecar behind as a TOMBSTONE — no file, just enough state for `/check` to
   *  keep answering `rejected` — until the 30-day sweep drops it too. So
   *  `resolvedAt !== undefined` means "the bytes are gone; this is a
   *  tombstone", and `storedFilename` on such an entry is history, not a path
   *  that exists. */
  resolvedAt: z.string().optional(),
});

export type ScanQuarantineEntry = z.infer<typeof ScanQuarantineEntrySchema>;
export type ScanQuarantineState = ScanQuarantineEntry["state"];

/** Path of the box's scan quarantine directory. Pure — touches no disk. */
export function quarantineDir(boxRoot: string): string {
  return path.join(boxTmpDir(boxRoot), QUARANTINE_DIR_NAME);
}

/** Ensure the quarantine directory exists and return it. */
export async function ensureQuarantineDir(boxRoot: string): Promise<string> {
  const dir = quarantineDir(boxRoot);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Absolute path of a stored quarantine file (`<sha256>.<ext>`). */
export function quarantineFilePath(boxRoot: string, storedFilename: string): string {
  return path.join(quarantineDir(boxRoot), storedFilename);
}

function sidecarPath(boxRoot: string, sha256: string): string {
  return path.join(quarantineDir(boxRoot), `${sha256}.json`);
}

/** Write a sidecar atomically (temp + rename) so a crash mid-write can never
 *  leave a half-written state machine behind. */
async function writeSidecar(boxRoot: string, entry: ScanQuarantineEntry): Promise<void> {
  const target = sidecarPath(boxRoot, entry.sha256);
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`);
  await fs.rename(tmp, target);
}

/** Record (or replace) a quarantine entry's sidecar. Replacement is the retry
 *  path: a re-PUT of a `rejected` hash re-runs validation and overwrites the
 *  old verdict rather than accumulating a second one. */
export async function recordQuarantineEntry(boxRoot: string, entry: ScanQuarantineEntry): Promise<void> {
  await ensureQuarantineDir(boxRoot);
  await writeSidecar(boxRoot, entry);
}

/** Read one entry by hash, or null when quarantine holds nothing for it. */
export async function readQuarantineEntry(boxRoot: string, sha256: string): Promise<ScanQuarantineEntry | null> {
  let text: string;
  try {
    text = await fs.readFile(sidecarPath(boxRoot, sha256), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  return parseSidecar(text, sidecarPath(boxRoot, sha256));
}

/** Parse sidecar text, or null (logged) when it's unreadable — a corrupt
 *  sidecar must not take the whole scan down; the file itself is still on disk
 *  and a re-PUT rewrites the verdict. */
function parseSidecar(text: string, atPath: string): ScanQuarantineEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.error(`[scan] Quarantine sidecar ${atPath} is not valid JSON:`, e);
    return null;
  }
  const parsed = ScanQuarantineEntrySchema.safeParse(raw);
  if (!parsed.success) {
    // The field list, not zod's full multi-page dump: this is a one-line "go
    // look at that file" signal, and the file itself holds the detail.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    console.error(`[scan] Quarantine sidecar ${atPath} does not match the entry schema (bad fields: ${fields})`);
    return null;
  }
  return parsed.data;
}

/** Every readable entry in quarantine, sorted by hash for stable output. */
export async function readAllQuarantineEntries(boxRoot: string): Promise<ScanQuarantineEntry[]> {
  const dir = quarantineDir(boxRoot);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const entries: ScanQuarantineEntry[] = [];
  for (const name of names.toSorted()) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    const entry = parseSidecar(await fs.readFile(full, "utf-8"), full);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Advance an entry's state machine in place, returning the updated entry (null
 * when no such entry exists). Serialized per sidecar with `withCardLock` — the
 * promote worker and an in-flight PUT can both target one hash.
 */
export async function updateQuarantineState(
  boxRoot: string,
  opts: {
    sha256: string;
    state: ScanQuarantineState;
    reason?: string;
    questionRef?: string;
    resolvedAt?: string;
  },
): Promise<ScanQuarantineEntry | null> {
  const target = sidecarPath(boxRoot, opts.sha256);
  return withCardLock(target, async () => {
    const entry = await readQuarantineEntry(boxRoot, opts.sha256);
    if (!entry) return null;
    const updated: ScanQuarantineEntry = { ...entry, state: opts.state };
    if (opts.reason !== undefined) updated.reason = opts.reason;
    if (opts.questionRef !== undefined) updated.questionRef = opts.questionRef;
    if (opts.resolvedAt !== undefined) updated.resolvedAt = opts.resolvedAt;
    await writeSidecar(boxRoot, updated);
    return updated;
  });
}

/** Delete an entry's stored bytes, leaving the sidecar. Used by the GC when a
 *  rejection's question is resolved: the verdict outlives the file. */
export async function deleteQuarantineFile(boxRoot: string, entry: ScanQuarantineEntry): Promise<void> {
  await fs.rm(quarantineFilePath(boxRoot, entry.storedFilename), { force: true });
}

/** Delete an entry outright — stored bytes and sidecar. After this the hash is
 *  `unknown` to `/check` again (for an imported entry the upload ledger keeps
 *  answering `imported`, which is why imported entries can go early). */
export async function deleteQuarantineEntry(boxRoot: string, entry: ScanQuarantineEntry): Promise<void> {
  await deleteQuarantineFile(boxRoot, entry);
  await fs.rm(sidecarPath(boxRoot, entry.sha256), { force: true });
}
