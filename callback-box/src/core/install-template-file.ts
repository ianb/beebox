/**
 * Shared logic for installing template-managed files into a box.
 *
 * The bookkeeping problem this solves: callback-box ships templates
 * (procedures, guides, schedules, the personality seed, the root
 * landmark, the briefing). When a template changes upstream, we want to
 * push the new version into boxes — but only if the local copy hasn't
 * been customised. If it has, the new version goes into
 * `config/_template-updates/<path>` for the boxholder to review.
 *
 * "Has it been customised" is tracked via `config/template-versions.json`:
 * a hash of every template we have ever written cleanly. If the local
 * file's hash matches the last recorded hash, the user hasn't touched
 * it since we installed it — so it's safe to overwrite with the new
 * template. If the local file's hash diverges from the recorded one,
 * the user (or some agent) edited it, and we park the new version.
 *
 * For files with volatile content (timestamps regenerated each install
 * — guides, personality), pass a `normalize` function. Hashing the
 * normalized form makes "did the user edit it" comparison stable
 * across reinstalls that only differ in timestamp.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

const VERSIONS_FILE = "config/template-versions.json";
const TEMPLATE_UPDATES_DIR = "config/_template-updates";

interface VersionsFile {
  [relPath: string]: {
    /** sha256 of the (normalized) template content as we last installed it. */
    sha256: string;
    "installed-at": string;
  };
}

export interface InstallTemplateOptions {
  /** Box root absolute path. */
  boxRoot: string;
  /** Path under boxRoot, e.g. `config/calendar.guide.card`. */
  relPath: string;
  /** New template content to install. */
  templateContent: string;
  /**
   * Optional normalizer for content with volatile fields (timestamps).
   * Both the local file and the template are normalized before hashing
   * so timestamp-only differences don't read as "user modified."
   */
  normalize?: (content: string) => string;
}

export type InstallOutcome =
  | "fresh"               // file didn't exist; wrote template
  | "unchanged"           // local already matches template (modulo normalization); no write
  | "overwritten"         // local matched the last recorded version; safely overwrote
  | "parked"              // local diverged; new version sat in _template-updates/ for review
  | "skipped";            // file exists but template content also unchanged from last install

export interface InstallResult {
  outcome: InstallOutcome;
  /** Relative path that was written (the original relPath or the parked path). */
  writtenAt?: string;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function readVersions(boxRoot: string): Promise<VersionsFile> {
  const abs = path.join(boxRoot, VERSIONS_FILE);
  try {
    const text = await fs.readFile(abs, "utf-8");
    const parsed = JSON.parse(text) as VersionsFile;
    return parsed;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    throw e;
  }
}

async function writeVersions(boxRoot: string, versions: VersionsFile): Promise<void> {
  const abs = path.join(boxRoot, VERSIONS_FILE);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // Sorted keys for stable diffs.
  const sorted: VersionsFile = {};
  for (const k of Object.keys(versions).toSorted()) sorted[k] = versions[k]!;
  await fs.writeFile(abs, JSON.stringify(sorted, null, 2) + "\n");
}

/**
 * Install one template file into a box. See module docstring.
 */
export async function installTemplateFile(opts: InstallTemplateOptions): Promise<InstallResult> {
  const { boxRoot, relPath, templateContent } = opts;
  const normalize = opts.normalize ?? ((s) => s);
  const targetAbs = path.join(boxRoot, relPath);

  await fs.mkdir(path.dirname(targetAbs), { recursive: true });

  let localContent: string | null = null;
  try {
    localContent = await fs.readFile(targetAbs, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }

  const templateHash = sha256(normalize(templateContent));

  if (localContent === null) {
    await fs.writeFile(targetAbs, templateContent);
    const versions = await readVersions(boxRoot);
    versions[relPath] = { sha256: templateHash, "installed-at": new Date().toISOString() };
    await writeVersions(boxRoot, versions);
    return { outcome: "fresh", writtenAt: relPath };
  }

  const localHash = sha256(normalize(localContent));

  // Local is already what we'd write — no-op (avoids dirtying the working
  // tree on every install with no semantic change).
  if (localHash === templateHash) {
    // Record the hash even on no-op so a box installed at version V1 by
    // an older callback-box (before this tracker existed) gets bootstrapped.
    const versions = await readVersions(boxRoot);
    if (versions[relPath]?.sha256 !== templateHash) {
      versions[relPath] = { sha256: templateHash, "installed-at": new Date().toISOString() };
      await writeVersions(boxRoot, versions);
    }
    return { outcome: "unchanged" };
  }

  const versions = await readVersions(boxRoot);
  const lastInstalledHash = versions[relPath]?.sha256;

  // Local matches the version we last installed → user hasn't touched
  // it since. Safe to overwrite with the new template.
  if (lastInstalledHash !== undefined && lastInstalledHash === localHash) {
    await fs.writeFile(targetAbs, templateContent);
    versions[relPath] = { sha256: templateHash, "installed-at": new Date().toISOString() };
    await writeVersions(boxRoot, versions);
    return { outcome: "overwritten", writtenAt: relPath };
  }

  // Local differs from both the new template and our last-installed
  // record. Either the user edited it, or the file predates the
  // tracker. Park the new template under `_template-updates/` mirroring
  // the original relpath verbatim (e.g. `config/foo.guide.card` →
  // `config/_template-updates/config/foo.guide.card`) so the
  // copy-back-to-accept path is obvious. Don't update the recorded
  // hash — if the user later accepts the new template by copying it
  // into place, the next install will recognise it as the current
  // template and overwrite cleanly.
  const updateAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR, relPath);
  await fs.mkdir(path.dirname(updateAbs), { recursive: true });
  await fs.writeFile(updateAbs, templateContent);
  return { outcome: "parked", writtenAt: path.relative(boxRoot, updateAbs) };
}

/**
 * Default stale threshold for parked template updates: 30 days.
 *
 * Rationale: if the boxholder hasn't reviewed a parked template update in a
 * month, they're not going to. Either they actively want their version (in
 * which case the parked copy is noise) or they missed the prompt (in which
 * case it'll re-park on the next template change). Sweeping prevents
 * `config/_template-updates/` from accumulating cruft indefinitely.
 */
export const STALE_TEMPLATE_UPDATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete parked template-update files under `config/_template-updates/`
 * whose mtime is older than `maxAgeMs` (default 30 days). Empty parent
 * directories are removed too. Returns the relative paths of removed files.
 *
 * Idempotent and silent — safe to call from `syncTemplatesFromSource` every
 * cycle. Doesn't touch anything outside `config/_template-updates/`.
 */
export async function pruneStaleTemplateUpdates(
  boxRoot: string,
  options?: { maxAgeMs?: number; now?: number },
): Promise<string[]> {
  options = options ?? {};
  const maxAgeMs = options.maxAgeMs ?? STALE_TEMPLATE_UPDATE_MS;
  const now = options.now ?? Date.now();
  const rootAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true, recursive: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw e;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Node 20: Dirent.parentPath is the directory containing the entry.
    const fileAbs = path.join((entry as unknown as { parentPath: string }).parentPath, entry.name);
    const stat = await fs.stat(fileAbs);
    if (now - stat.mtimeMs < maxAgeMs) continue;
    await fs.unlink(fileAbs);
    removed.push(path.relative(boxRoot, fileAbs));
  }

  // Sweep empty directories from deepest first so parents become empty too.
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join((e as unknown as { parentPath: string }).parentPath, e.name))
    .toSorted((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      await fs.rmdir(dir);
    } catch (e) {
      // Not empty (or already gone) — leave it. Sweeping is best-effort.
      console.debug("Leaving non-empty template-updates dir:", dir, e);
    }
  }

  return removed;
}

