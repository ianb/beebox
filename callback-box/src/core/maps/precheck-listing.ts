/**
 * Directory and children listing for the map refresh precheck.
 *
 * The filesystem/git walking half of the precheck: which directories deserve
 * a MAP.md (`listMappableDirs`), whether a MAP.md exists (`fileExists`), and
 * the immediate-children listings at a commit (`listChildrenAtCommit`) or on
 * disk (`listChildrenOnDisk`) that the diff in `precheck.ts` compares.
 *
 * Depends only on `precheck-ignore.ts` (a leaf), never back on `precheck.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { simpleGit } from "simple-git";
import { isIgnored, joinChildPath } from "./precheck-ignore.js";

/**
 * Recursively list every directory in the box that should have a MAP.md.
 * Returns dir paths relative to boxRoot.
 *
 * Rules:
 * - **Container rule**: a dir needs at least one visible subdirectory to
 *   qualify. File-only ("leaf") dirs are skipped — the parent's MAP.md
 *   already lists them, and an `ls` shows their contents directly. Shell
 *   dirs (subdirs hidden by ignore patterns leave the parent looking empty)
 *   are skipped at the dir-itself level but still appear in their parent's
 *   listing — that's where their description belongs.
 * - **Useful-content rule**: a dir needs ≥2 total visible children
 *   (subdirs + files) to qualify. A single-entry MAP just restates one
 *   bullet; not worth a file.
 * - **Root is always skipped**: every top-level directory in a box is part
 *   of the cb-init skeleton (`store/`, `box/`, `config/`, ...) and is
 *   already documented in CLAUDE.md / `docs/box-layout.md`. The root MAP
 *   would be pure boilerplate.
 */
export async function listMappableDirs(
  boxRoot: string,
  patterns: readonly string[],
): Promise<string[]> {
  const result: string[] = [];

  /** Returns the count of visible immediate subdirs in `rel`. */
  async function walk(rel: string): Promise<number> {
    const abs = path.join(boxRoot, rel);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to read directory ${abs} while walking for mappable dirs, skipping:`, e);
      }
      return 0;
    }
    let visibleSubdirs = 0;
    let visibleFiles = 0;
    for (const entry of entries) {
      const isDir = entry.isDirectory();
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (isIgnored({ patterns, relPath: childRel, isFile: !isDir })) continue;
      if (isDir) {
        visibleSubdirs += 1;
        await walk(childRel);
      } else {
        visibleFiles += 1;
      }
    }
    const isRoot = rel === "";
    const totalVisible = visibleSubdirs + visibleFiles;
    if (!isRoot && visibleSubdirs > 0 && totalVisible >= 2) {
      result.push(rel);
    }
    return visibleSubdirs;
  }

  await walk("");
  return result.toSorted();
}

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    // fs.access throws iff the path is inaccessible/absent — that is exactly
    // the "false" answer this predicate exists to report; the error carries
    // no information beyond that.
    return false;
  }
}

interface ListChildrenAtCommitOptions {
  boxRoot: string;
  dirRel: string;
  commit: string;
  patterns: readonly string[];
}

/**
 * Get immediate children of dirRel at the given commit. Names ending in "/"
 * are subdirectories; everything else is a file. Returns sorted; meta files
 * and ignored names are filtered out.
 */
export async function listChildrenAtCommit(opts: ListChildrenAtCommitOptions): Promise<string[]> {
  const { boxRoot, dirRel, commit, patterns } = opts;
  const ref = dirRel === "" ? commit : `${commit}:${dirRel}`;
  let raw: string;
  try {
    raw = await simpleGit(boxRoot).raw(["ls-tree", ref]);
  } catch (e) {
    // ls-tree fails when the dir didn't exist at this commit (e.g. comparing
    // against an older asOf where the path was absent). Treat as empty listing
    // so the diff still reports the right added/deleted set.
    console.debug(`git ls-tree ${ref} failed, treating as empty listing:`, e);
    return [];
  }
  const items: string[] = [];
  for (const line of raw.split("\n")) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).split(/\s+/);
    if (meta.length < 3) continue;
    const type = meta[1];
    const name = line.slice(tabIdx + 1);
    const isFile = type !== "tree";
    if (isIgnored({ patterns, relPath: joinChildPath(dirRel, name), isFile })) continue;
    items.push(isFile ? name : `${name}/`);
  }
  return items.toSorted();
}

interface ListChildrenOnDiskOptions {
  boxRoot: string;
  dirRel: string;
  patterns: readonly string[];
}

/**
 * Get immediate children of dirRel from the working tree (used when no
 * prior state exists, since there's nothing to diff against).
 */
export async function listChildrenOnDisk(opts: ListChildrenOnDiskOptions): Promise<string[]> {
  const { boxRoot, dirRel, patterns } = opts;
  const abs = path.join(boxRoot, dirRel);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to read directory ${abs} for on-disk children listing, treating as empty:`, e);
    }
    return [];
  }
  const items: string[] = [];
  for (const entry of entries) {
    const isFile = !entry.isDirectory();
    if (isIgnored({ patterns, relPath: joinChildPath(dirRel, entry.name), isFile })) continue;
    items.push(isFile ? entry.name : `${entry.name}/`);
  }
  return items.toSorted();
}
