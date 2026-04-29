/**
 * Helpers for the `upload` command — content-hash dedup ledger and streaming
 * SHA-256 of files. The ledger lives at `.callback-box/uploads.json` (per-box,
 * untracked) and survives file renames/relocations because it keys on content.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface UploadLedgerEntry {
  /** SHA-256 hex digest of the original file's contents. */
  hash: string;
  /** Basename of the file at upload time. */
  originalName: string;
  /** Absolute path of the file at upload time (informational; may move). */
  originalPath: string;
  /** ISO datetime when the upload was recorded. */
  uploadedAt: string;
  /** Destination kind (e.g. "scan"). */
  kind: string;
  /** Box-relative session directory the upload produced, when applicable. */
  sessionRelDir?: string;
}

export interface UploadLedger {
  version: 1;
  entries: UploadLedgerEntry[];
}

export const LEDGER_REL_PATH = ".callback-box/uploads.json";

export function emptyLedger(): UploadLedger {
  return { version: 1, entries: [] };
}

export function findEntry(ledger: UploadLedger, hash: string): UploadLedgerEntry | undefined {
  return ledger.entries.find((e) => e.hash === hash);
}

export function addEntry(ledger: UploadLedger, entry: UploadLedgerEntry): void {
  ledger.entries.push(entry);
}

export async function loadLedger(boxRoot: string): Promise<UploadLedger> {
  const ledgerPath = path.join(boxRoot, LEDGER_REL_PATH);
  let content: string;
  try {
    content = await fs.readFile(ledgerPath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return emptyLedger();
    throw e;
  }
  const parsed = JSON.parse(content) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new Error(`Ledger at ${ledgerPath} is not in the expected format (version: 1, entries: [...])`);
  }
  return parsed as UploadLedger;
}

export async function saveLedger(boxRoot: string, ledger: UploadLedger): Promise<void> {
  const ledgerPath = path.join(boxRoot, LEDGER_REL_PATH);
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  // tmp + rename for atomicity — a crash mid-write can't leave a corrupted ledger.
  const tmp = `${ledgerPath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  await fs.rename(tmp, ledgerPath);
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
