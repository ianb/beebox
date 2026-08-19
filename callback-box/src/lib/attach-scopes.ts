/**
 * Finding `.attach/` directories.
 *
 * Extracted from `core/asset-manifest-scan.ts` so the git-annex code does not
 * depend on the manifest scanner it replaces — otherwise retiring manifests
 * would mean unpicking this walk from underneath the annex doctor and the
 * unlisted-binary guard first.
 *
 * A pure directory walk with no notion of manifests, assets, or annex keys:
 * it answers "where are the attach scopes", and callers decide what that means.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { errnoCode } from "./error-guards.js";

/** A directory whose name ends in `.attach`. */
export interface AttachScope {
  /** Absolute path. */
  absPath: string;
  /** Path relative to the box root, for log messages. */
  relPath: string;
}

/**
 * Directories never descended into. Matched against a directory's basename
 * (`Dirent.name`), never a path, so a single `"node_modules"` entry already
 * covers a trick's nested `node_modules/` wherever it lives — no
 * shape-specific entry is needed.
 */
const SKIP_DIRS = new Set([".git", "node_modules", ".callback-box", ".scan-archive", ".scan-api"]);

/**
 * Is `relPath` a file inside an attach scope — i.e. does one of its *directory*
 * segments end in `.attach`?
 *
 * The index-based counterpart to {@link findAttachScopes}: the pre-commit
 * unlisted-binary guard classifies staged paths, which may not resemble the
 * working tree (a staged delete, a path already replaced on disk), so it
 * decides membership from the path alone rather than by walking directories.
 * Honors the same {@link SKIP_DIRS} the walk never descends into, so the two
 * agree on what counts as a scope.
 */
export function isInAttachScope(relPath: string): boolean {
  const segments = relPath.split(/[/\\]/);
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return false;
  return segments.slice(0, -1).some((segment) => segment.endsWith(".attach"));
}

/**
 * Find every `.attach/` directory under boxRoot. Returns absolute and relative
 * paths so callers can log readably.
 *
 * Nested attach scopes are returned in their own right, so a caller walking a
 * scope's contents should skip child directories ending in `.attach` rather
 * than descending into them twice.
 */
export async function findAttachScopes(boxRoot: string): Promise<AttachScope[]> {
  const out: AttachScope[] = [];
  async function walk(absDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (e) {
      // A directory we can't read (race with a delete, permissions, or a
      // non-dir that slipped through) contributes no attach scopes. Logged so
      // an unexpected IO failure during the walk stays visible.
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Could not read ${absDir} while finding attach scopes, skipping:`, e);
      }
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const child = path.join(absDir, e.name);
      if (e.name.endsWith(".attach")) {
        out.push({ absPath: child, relPath: path.relative(boxRoot, child) });
      }
      await walk(child);
    }
  }
  await walk(boxRoot);
  return out;
}
