/**
 * Directory and children listing for the map refresh precheck.
 *
 * The filesystem/git walking half of the precheck: which directories deserve
 * a MAP.md (`listMappableDirs`) and the immediate-children listings at a commit
 * (`listChildrenAtCommit`) or on disk (`listChildrenOnDisk`) that the diff in
 * `precheck.ts` compares.
 *
 * Depends only on `precheck-ignore.ts` (a leaf), never back on `precheck.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { simpleGit } from "simple-git";
import { gitBoxPrefix } from "../../lib/git.js";
import { isIgnored, joinChildPath } from "./precheck-ignore.js";
import { errnoCode } from "../../lib/error-guards.js";
import { ok, err, type Result } from "../../lib/result.js";

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
      if (errnoCode(e) !== "ENOENT") {
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

interface ListChildrenAtCommitOptions {
  boxRoot: string;
  dirRel: string;
  commit: string;
  patterns: readonly string[];
}

/** Why a listing at a commit could not be produced. */
export interface ListingUnavailable {
  reason: "commit_unresolvable";
  commit: string;
}

/**
 * Does `commit` resolve to a commit object in this repo?
 *
 * The discriminator that lets {@link listChildrenAtCommit} tell "the path
 * wasn't there at that commit" from "that commit is gone". `git ls-tree`
 * cannot: in the `<rev>:<path>` form both cases exit 128 with a byte-identical
 * `fatal: Not a valid object name <rev>:<path>`, so neither the exit code nor
 * the message can separate them. An affirmative `rev-parse --verify` can, and
 * doesn't depend on parsing human-readable git output.
 */
async function commitResolves(boxRoot: string, commit: string): Promise<boolean> {
  let out: string;
  try {
    out = await simpleGit(boxRoot).raw(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  } catch (_e) {
    // Non-zero exit is the answer we asked for, not a failure: this commit
    // does not resolve. The caller turns that into a typed `err`.
    return false;
  }
  // `--quiet` keeps a routine miss off stderr, but simple-git decides whether
  // to throw by *inspecting* stderr — so with it, a failed lookup resolves to
  // an empty string rather than raising. The printed hash is the real signal;
  // trusting the absence of a throw would report every bad commit as valid.
  return out.trim() !== "";
}

/**
 * Get immediate children of dirRel at the given commit. Names ending in "/"
 * are subdirectories; everything else is a file. Returns sorted; meta files
 * and ignored names are filtered out.
 *
 * Returns an `err` only when `commit` itself doesn't resolve. A resolvable
 * commit whose tree simply lacks `dirRel` yields `ok([])` — that's a real,
 * ordinary answer (the directory was added later), and treating it as an empty
 * listing is correct rather than a guess.
 */
export async function listChildrenAtCommit(
  opts: ListChildrenAtCommitOptions,
): Promise<Result<string[], ListingUnavailable>> {
  const { boxRoot, dirRel, commit, patterns } = opts;
  if (!(await commitResolves(boxRoot, commit))) {
    return err({ reason: "commit_unresolvable", commit });
  }
  // `<commit>:<path>` is interpreted relative to the CWD when git runs inside a
  // subdirectory of the repo. On a v2 box the box root (`content/`) is exactly
  // such a subdir, so `<commit>:store` would resolve to `content/content/store`
  // (empty) and maps would never detect a change. `--full-tree` pins the path
  // to the repo root, and we spell it out repo-root-relative by prefixing the
  // box's in-repo path (`content/`); on a legacy box the prefix is empty and
  // the whole-tree case stays a bare `<commit>`.
  const prefix = await gitBoxPrefix(boxRoot);
  const repoRel = `${prefix}${dirRel}`.replace(/\/$/, "");
  const ref = repoRel === "" ? commit : `${commit}:${repoRel}`;
  let raw: string;
  try {
    raw = await simpleGit(boxRoot).raw(["ls-tree", "--full-tree", ref]);
  } catch (_e) {
    // The commit resolves (checked above), so the only remaining reason
    // ls-tree can fail on `<commit>:<path>` is that the path wasn't in that
    // commit's tree — the directory was added later. An empty listing is the
    // correct answer here, not a fallback.
    return ok([]);
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
  return ok(items.toSorted());
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
    if (errnoCode(e) !== "ENOENT") {
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
