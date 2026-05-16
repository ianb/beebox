/**
 * Walk a box's `.attach/` directories and reconcile each one's manifest
 * against the files on disk. Used by:
 *   - the pre-commit hook (block on errors, auto-claim new files)
 *   - `cb attachments migrate` (claim every binary into a manifest)
 *   - `cb attachments verify` (read-only check)
 *
 * See docs/attach-manifests.md for the algorithm.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import {
  type AttachManifest,
  type AttachManifestEntry,
  MANIFEST_FILENAME,
  computeEntry,
  entryMatchesStat,
  loadManifest,
  saveManifest,
  sha256File,
} from "./attach-manifest.js";

/** A directory whose name ends in `.attach`. */
export interface AttachScope {
  /** Absolute path. */
  absPath: string;
  /** Path relative to the box root, for log messages. */
  relPath: string;
}

export interface ScanResultErrorMissing {
  kind: "missing-file";
  attachDir: string;  // relative path
  name: string;
  message: string;
}

export interface ScanResultErrorHashMismatch {
  kind: "hash-mismatch";
  attachDir: string;
  name: string;
  message: string;
}

export interface ScanResultErrorManifestMalformed {
  kind: "manifest-malformed";
  attachDir: string;
  name: null;
  message: string;
}

export type ScanError =
  | ScanResultErrorMissing
  | ScanResultErrorHashMismatch
  | ScanResultErrorManifestMalformed;

export interface ScanScopeResult {
  attachDir: string;  // relative path
  /** Files newly added to the manifest by this scan. */
  claimed: string[];
  /** Files whose mtime bumped without hash change (manifest mtime refreshed). */
  refreshed: string[];
  /** Hash-stable renames detected and applied. */
  renamed: { from: string; to: string }[];
  /** Files left unchanged (manifest entry still valid by stat-shortcut). */
  unchanged: string[];
  /** Per-scope errors. Caller decides whether to block. */
  errors: ScanError[];
  /** Whether the manifest was written back to disk. */
  manifestUpdated: boolean;
}

export interface ScanOptions {
  /** When true, scan reads disk only; manifests are not written. */
  dryRun?: boolean;
}

/** Directories that should never be descended into when finding attach scopes. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".callback-box",
  "tricks/node_modules",
  ".scan-archive",
  ".scan-api",
]);

/**
 * Find every `.attach/` directory under boxRoot. Returns absolute and
 * relative paths so callers can log readably.
 */
export async function findAttachScopes(boxRoot: string): Promise<AttachScope[]> {
  const out: AttachScope[] = [];
  async function walk(absDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const child = path.join(absDir, e.name);
      if (e.name.endsWith(".attach")) {
        out.push({
          absPath: child,
          relPath: path.relative(boxRoot, child),
        });
      }
      await walk(child);
    }
  }
  await walk(boxRoot);
  return out;
}

/**
 * Reconcile a single `.attach/` directory against its manifest. Returns the
 * categorized changes; writes manifest to disk unless `dryRun` is set.
 */
export async function scanAttachScope(
  scope: AttachScope,
  options: ScanOptions = {}
): Promise<ScanScopeResult> {
  const result: ScanScopeResult = {
    attachDir: scope.relPath,
    claimed: [],
    refreshed: [],
    renamed: [],
    unchanged: [],
    errors: [],
    manifestUpdated: false,
  };

  // Load manifest. Malformed-manifest is an error but we can't proceed for this
  // scope, so return early.
  let manifest: AttachManifest;
  try {
    manifest = await loadManifest(scope.absPath);
  } catch (e) {
    result.errors.push({
      kind: "manifest-malformed",
      attachDir: scope.relPath,
      name: null,
      message: (e as Error).message,
    });
    return result;
  }

  // List direct children that are regular files and aren't the manifest itself.
  // Cards (.card files) commit normally and aren't manifest-tracked. Nested
  // attach dirs are handled by their own scans.
  const dirents = await fs.readdir(scope.absPath, { withFileTypes: true });
  const fileNames: string[] = [];
  for (const d of dirents) {
    if (!d.isFile()) continue;
    if (d.name === MANIFEST_FILENAME) continue;
    if (d.name.endsWith(".card")) continue;
    fileNames.push(d.name);
  }

  const startedFromEmpty = Object.keys(manifest.files).length === 0;
  const fileNameSet = new Set(fileNames);
  const manifestNames = new Set(Object.keys(manifest.files));

  // First pass: classify each on-disk file.
  // Defer rename detection until we know which manifest entries are orphaned.
  const newFiles: string[] = [];  // on disk, not in manifest
  const stableFiles: string[] = [];  // on disk, in manifest, stat matches
  const changedFiles: string[] = [];  // on disk, in manifest, stat differs
  for (const name of fileNames) {
    const absPath = path.join(scope.absPath, name);
    const stat = await fs.stat(absPath);
    const entry = manifest.files[name];
    if (!entry) {
      newFiles.push(name);
    } else if (entryMatchesStat(entry, stat)) {
      stableFiles.push(name);
    } else {
      changedFiles.push(name);
    }
  }

  // Orphaned manifest entries (entries with no file on disk).
  const orphans = [...manifestNames].filter((n) => !fileNameSet.has(n));

  // Hash newFiles (for claim or rename) and changedFiles (to compare against
  // stored hash). Build a hash lookup so we can detect renames.
  const hashCache = new Map<string, AttachManifestEntry>();  // name → fresh entry
  for (const name of [...newFiles, ...changedFiles]) {
    const absPath = path.join(scope.absPath, name);
    hashCache.set(name, await computeEntry(absPath));
  }

  // Rename detection: an orphan + a new file sharing the same hash.
  // (This catches `mv old new` within the same attach dir.)
  const renamedFroms = new Set<string>();
  for (const newName of newFiles) {
    const newEntry = hashCache.get(newName)!;
    for (const orphan of orphans) {
      if (renamedFroms.has(orphan)) continue;
      const orphanEntry = manifest.files[orphan]!;
      if (orphanEntry.sha256 === newEntry.sha256) {
        manifest.files[newName] = orphanEntry;  // preserve original entry metadata
        delete manifest.files[orphan];
        renamedFroms.add(orphan);
        result.renamed.push({ from: orphan, to: newName });
        break;
      }
    }
  }

  // For new files that weren't part of a rename, claim them.
  for (const name of newFiles) {
    if (result.renamed.some((r) => r.to === name)) continue;
    manifest.files[name] = hashCache.get(name)!;
    result.claimed.push(name);
  }

  // For changed files (stat differs but file existed in manifest):
  for (const name of changedFiles) {
    const oldEntry = manifest.files[name]!;
    const fresh = hashCache.get(name)!;
    if (oldEntry.sha256 === fresh.sha256) {
      // Hash unchanged — just refresh the mtime so the stat-shortcut works next time.
      manifest.files[name] = { ...oldEntry, mtime: fresh.mtime };
      result.refreshed.push(name);
    } else {
      // Real content change — error out, leave manifest alone.
      result.errors.push({
        kind: "hash-mismatch",
        attachDir: scope.relPath,
        name,
        message: `${scope.relPath}/${name} was modified out of band. Run 'cb overwrite ${scope.relPath}/${name} < ...' to accept the new content, or restore from backup.`,
      });
    }
  }

  // Remaining orphans (not part of a detected rename) are missing files.
  for (const orphan of orphans) {
    if (renamedFroms.has(orphan)) continue;
    result.errors.push({
      kind: "missing-file",
      attachDir: scope.relPath,
      name: orphan,
      message: `${scope.relPath}/${orphan} is listed in the manifest but missing from disk. Run 'cb rm ${scope.relPath}/${orphan}' to remove the entry, or restore the file.`,
    });
  }

  // Files that didn't change at all — for completeness in the return value.
  result.unchanged = stableFiles;

  // Decide whether to write the manifest.
  const changedManifest =
    result.claimed.length > 0 ||
    result.refreshed.length > 0 ||
    result.renamed.length > 0;

  // If we started with no manifest file on disk and have nothing to claim,
  // don't create an empty manifest — less noise in attach dirs that genuinely
  // have no tracked content yet.
  const hasEntries = Object.keys(manifest.files).length > 0;
  const shouldWrite = changedManifest && (hasEntries || !startedFromEmpty);

  if (shouldWrite && !options.dryRun) {
    await saveManifest(scope.absPath, manifest);
    result.manifestUpdated = true;
  }

  return result;
}

export interface ScanBoxResult {
  scopes: ScanScopeResult[];
  /** Flat list of errors across all scopes, for quick "any errors?" checks. */
  errors: ScanError[];
}

/**
 * Walk every attach scope in the box and reconcile each manifest. Returns the
 * combined results so the caller can decide what to do with errors.
 */
export async function scanBoxAttachments(
  boxRoot: string,
  options: ScanOptions = {}
): Promise<ScanBoxResult> {
  const scopes = await findAttachScopes(boxRoot);
  const results: ScanScopeResult[] = [];
  const errors: ScanError[] = [];
  for (const scope of scopes) {
    const r = await scanAttachScope(scope, options);
    results.push(r);
    errors.push(...r.errors);
  }
  return { scopes: results, errors };
}

/** Re-export so callers don't need to reach into two files. */
export { sha256File };
