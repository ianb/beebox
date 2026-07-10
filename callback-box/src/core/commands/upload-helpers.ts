/**
 * Helpers for the `upload` command — content-hash dedup ledger and streaming
 * SHA-256 of files. The ledger lives at `.callback-box/uploads.json` (per-box,
 * untracked) and survives file renames/relocations because it keys on content.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { invariant } from "../../lib/invariant.js";
import { errnoCode } from "../../lib/error-guards.js";

export const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];
export const PDF_EXTENSION = ".pdf";

class UnsupportedFileTypeError extends Error {
  readonly names: string;
  constructor(names: string) {
    super(`Unsupported file type(s): ${names}. Supported: ${PDF_EXTENSION}, ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}`);
    this.name = "UnsupportedFileTypeError";
    this.names = names;
  }
}

class MalformedLedgerError extends Error {
  readonly ledgerPath: string;
  constructor(ledgerPath: string) {
    super(`Ledger at ${ledgerPath} is not in the expected format (version: 1, entries: [...])`);
    this.name = "MalformedLedgerError";
    this.ledgerPath = ledgerPath;
  }
}

/**
 * A scan-import dispatch group. PDFs are always single-file groups; image
 * files are grouped by scanner-style `<prefix>_NNN.ext` filename, with any
 * unmatched images lumped into one fallback group.
 */
export interface ScanGroup {
  kind: "image-batch" | "pdf";
  /** Absolute paths, sorted. */
  files: string[];
  /** Human label — scanner prefix, PDF basename, or "(loose images)". */
  label: string;
}

const SCANNER_PREFIX_RE = /^(.+)[_-]\d+\.(jpg|jpeg|png|tif|tiff)$/i;

function isImage(file: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

function isPdf(file: string): boolean {
  return path.extname(file).toLowerCase() === PDF_EXTENSION;
}

/**
 * Partition a flat list of input files into scan-import dispatch groups.
 *
 * - Each PDF becomes its own group (one PDF → one session).
 * - Image files are grouped by the prefix before `_NNN.ext` (the convention
 *   of consumer flatbed scanners that emit one JPEG per page from a feeder).
 * - Image files that don't match the prefix pattern get bundled together
 *   into one fallback group ("loose images") — caller's invocation defines
 *   the batch.
 *
 * Throws if any file has an unsupported extension.
 */
export function groupScanFiles(files: string[]): ScanGroup[] {
  const pdfs: string[] = [];
  const images: string[] = [];
  const unsupported: string[] = [];
  for (const f of files) {
    if (isPdf(f)) pdfs.push(f);
    else if (isImage(f)) images.push(f);
    else unsupported.push(f);
  }
  if (unsupported.length > 0) {
    const names = unsupported.map((f) => path.basename(f)).join(", ");
    throw new UnsupportedFileTypeError(names);
  }

  const groups: ScanGroup[] = [];

  for (const pdf of pdfs.toSorted()) {
    groups.push({
      kind: "pdf",
      files: [pdf],
      label: path.basename(pdf, path.extname(pdf)),
    });
  }

  const matched = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const img of images) {
    const m = path.basename(img).match(SCANNER_PREFIX_RE);
    if (m) {
      const prefix = m[1];
      invariant(prefix !== undefined, "SCANNER_PREFIX_RE's first capture group (.+) is mandatory, not optional");
      const arr = matched.get(prefix);
      if (arr) arr.push(img);
      else matched.set(prefix, [img]);
    } else {
      unmatched.push(img);
    }
  }
  const sortedEntries = [...matched.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  for (const [prefix, imgs] of sortedEntries) {
    groups.push({ kind: "image-batch", files: imgs.toSorted(), label: prefix });
  }
  if (unmatched.length > 0) {
    groups.push({ kind: "image-batch", files: unmatched.toSorted(), label: "(loose images)" });
  }

  return groups;
}

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
    if (errnoCode(e) === "ENOENT") return emptyLedger();
    throw e;
  }
  const parsed = JSON.parse(content) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new MalformedLedgerError(ledgerPath);
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
