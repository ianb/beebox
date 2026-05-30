/**
 * Asset manifests — track binary assets (the gitignored subset of
 * attachments) via a per-`.attach/` `manifest.json` file while the asset
 * bytes themselves stay gitignored. See docs/asset-manifests.md for the
 * full design.
 *
 * Terminology: an *attachment* is anything inside a `.attach/` scope (a
 * sidecar `.txt`, a notes file, etc.); an *asset* is the subset whose
 * bytes live on disk only and are tracked through this manifest.
 *
 * This file owns the manifest format and the pure read/write/hash helpers.
 * The hook-style directory walk that verifies + auto-claims lives in
 * src/core/asset-manifest-scan.ts.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface AssetManifestEntry {
  /** File size in bytes. */
  size: number;
  /** ISO mtime — used as a speed hint for the hash-skip path. Not load-bearing. */
  mtime: string;
  /** SHA-256 hex digest of the file's contents. */
  sha256: string;
}

export interface AssetManifest {
  /** Map of direct-child filename → entry. Does not include nested attach scopes. */
  files: Record<string, AssetManifestEntry>;
}

export const MANIFEST_FILENAME = "manifest.json";

class MalformedManifestError extends Error {
  constructor(filePath: string) {
    super(`Asset manifest at ${filePath} is malformed (expected { files: {...} })`);
    this.name = "MalformedManifestError";
  }
}

export function emptyManifest(): AssetManifest {
  return { files: {} };
}

export function manifestPath(attachDir: string): string {
  return path.join(attachDir, MANIFEST_FILENAME);
}

export function findEntry(m: AssetManifest, name: string): AssetManifestEntry | undefined {
  return m.files[name];
}

// Callers mutate `manifest.files` directly: `m.files[name] = entry` to add/update,
// `delete m.files[name]` to remove. Wrapper helpers don't pull their weight.

/**
 * Stat shortcut: does the existing manifest entry match the file's current
 * size + mtime? Used to skip rehashing during a directory walk.
 */
export function entryMatchesStat(
  entry: AssetManifestEntry,
  stat: { size: number; mtime: Date }
): boolean {
  return entry.size === stat.size && entry.mtime === stat.mtime.toISOString();
}

/**
 * Compute a fresh manifest entry from a file on disk (size, mtime, sha256).
 */
export async function computeEntry(absPath: string): Promise<AssetManifestEntry> {
  const stat = await fs.stat(absPath);
  return {
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: await sha256File(absPath),
  };
}

/**
 * Load a manifest from disk. Returns an empty manifest if the file doesn't
 * exist. Throws on JSON parse errors or shape mismatch so a corrupted
 * manifest fails loudly rather than silently behaving as if empty.
 */
export async function loadManifest(attachDir: string): Promise<AssetManifest> {
  const filePath = manifestPath(attachDir);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return emptyManifest();
    throw e as Error;
  }
  const parsed = JSON.parse(content) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { files?: unknown }).files !== "object" ||
    (parsed as { files: unknown }).files === null
  ) {
    throw new MalformedManifestError(filePath);
  }
  return parsed as AssetManifest;
}

/**
 * Atomically write a manifest to disk. Files are sorted by name for stable
 * diffs across runs.
 */
export async function saveManifest(
  attachDir: string,
  manifest: AssetManifest
): Promise<void> {
  await fs.mkdir(attachDir, { recursive: true });
  const filePath = manifestPath(attachDir);
  const sortedFiles: Record<string, AssetManifestEntry> = {};
  for (const key of Object.keys(manifest.files).toSorted()) {
    sortedFiles[key] = manifest.files[key]!;
  }
  const json = JSON.stringify({ files: sortedFiles }, null, 2) + "\n";
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, filePath);
}

/**
 * Stream-hash a file with SHA-256. Used for entries and for verification.
 */
export async function sha256File(absPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
