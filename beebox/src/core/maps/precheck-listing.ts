/**
 * Directory and children listing for the map refresh precheck.
 *
 * Every listing comes from one source: the git tree of a commit. The walker
 * that decides which directories deserve a MAP.md (`listMappableDirs`), the
 * current listing handed to the agent, and the prior listing it is diffed
 * against all read a {@link BoxTree}. They used to split between `readdir` and
 * `git ls-tree`, and a directory holding only gitignored files then counted
 * toward its parent's map, never dirtied it, and appeared in the listing or
 * not depending on which branch ran
 * (`issues/bugs/2026-08-24-map-children-git-vs-disk.md`). A MAP.md is committed
 * and travels with the box, so it describes the committed tree; gitignored
 * content is machine-local by the box's own declaration.
 *
 * Depends only on `precheck-ignore.ts` (a leaf), never back on `precheck.ts`.
 */

import { simpleGit } from "simple-git";
import { gitBoxPrefix } from "../../lib/git.js";
import { isIgnored, joinChildPath } from "./precheck-ignore.js";
import { ok, err, type Result } from "../../lib/result.js";

/** One immediate entry of a directory in a {@link BoxTree}. */
export interface TreeEntry {
  name: string;
  isDir: boolean;
}

/**
 * A commit's box subtree: box-relative directory path ("" for the box root)
 * to its immediate entries, unfiltered. Only directories git records appear —
 * git has no empty directories.
 */
export type BoxTree = ReadonlyMap<string, readonly TreeEntry[]>;

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
 *   of the bbx-init skeleton (`_content/`, `_config/`, ...) and is already
 *   documented in CLAUDE.md / `docs/box-layout.md`. The root MAP would be
 *   pure boilerplate.
 */
export function listMappableDirs(tree: BoxTree, patterns: readonly string[]): string[] {
  const result: string[] = [];

  function walk(rel: string): void {
    let visibleSubdirs = 0;
    let visibleFiles = 0;
    for (const entry of tree.get(rel) ?? []) {
      const childRel = joinChildPath(rel, entry.name);
      if (isIgnored({ patterns, relPath: childRel, isFile: !entry.isDir })) continue;
      if (entry.isDir) {
        visibleSubdirs += 1;
        walk(childRel);
      } else {
        visibleFiles += 1;
      }
    }
    if (rel !== "" && visibleSubdirs > 0 && visibleSubdirs + visibleFiles >= 2) {
      result.push(rel);
    }
  }

  walk("");
  return result.toSorted();
}

/**
 * Immediate children of `dirRel` in `tree`. Names ending in "/" are
 * subdirectories; everything else is a file. Sorted; meta files and ignored
 * names are filtered out. A directory absent from the tree yields `[]` — at a
 * prior commit that is the ordinary answer for a directory added later.
 */
export function listChildren(opts: { tree: BoxTree; dirRel: string; patterns: readonly string[] }): string[] {
  const { tree, dirRel, patterns } = opts;
  const items: string[] = [];
  for (const entry of tree.get(dirRel) ?? []) {
    if (isIgnored({ patterns, relPath: joinChildPath(dirRel, entry.name), isFile: !entry.isDir })) continue;
    items.push(entry.isDir ? `${entry.name}/` : entry.name);
  }
  return items.toSorted();
}

/** Why a listing at a commit could not be produced. */
export interface ListingUnavailable {
  reason: "commit_unresolvable";
  commit: string;
}

/**
 * Does `commit` resolve to a commit object in this repo?
 *
 * The discriminator that lets {@link readBoxTree} tell "the path
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
 * Read the box subtree of `commit` in one `git ls-tree` call.
 *
 * Returns an `err` only when `commit` itself doesn't resolve. A resolvable
 * commit that lacks the box's subtree yields an empty tree.
 *
 * `-z` matters: without it git quotes any path with a non-ASCII byte
 * (`"caf\303\251.md"`, `core.quotePath`), and a quoted name reads as a
 * different entry from the one on disk and in the map.
 *
 * On a box whose root is a subdirectory of the repo (`gitBoxPrefix` non-empty),
 * the tree-ish is `<commit>:<prefix>` and `--full-tree` keeps git from
 * reinterpreting it relative to the CWD, so output paths are box-relative.
 */
export async function readBoxTree(
  boxRoot: string,
  commit: string,
): Promise<Result<BoxTree, ListingUnavailable>> {
  if (!(await commitResolves(boxRoot, commit))) {
    return err({ reason: "commit_unresolvable", commit });
  }
  const prefix = (await gitBoxPrefix(boxRoot)).replace(/\/$/, "");
  const ref = prefix === "" ? commit : `${commit}:${prefix}`;
  const tree = new Map<string, TreeEntry[]>([["", []]]);
  let raw: string;
  try {
    raw = await simpleGit(boxRoot).raw(["ls-tree", "-r", "-t", "-z", "--full-tree", ref]);
  } catch (_e) {
    // The commit resolves (checked above), so the only way `<commit>:<prefix>`
    // fails is that the box's subtree wasn't in that commit. Empty is the
    // correct answer, not a fallback.
    return ok(tree);
  }
  for (const record of raw.split("\0")) {
    const tabIdx = record.indexOf("\t");
    if (tabIdx === -1) continue;
    const type = record.slice(0, tabIdx).split(" ")[1];
    const relPath = record.slice(tabIdx + 1);
    const slash = relPath.lastIndexOf("/");
    const parent = slash === -1 ? "" : relPath.slice(0, slash);
    const isDir = type === "tree";
    let siblings = tree.get(parent);
    if (!siblings) {
      siblings = [];
      tree.set(parent, siblings);
    }
    siblings.push({ name: relPath.slice(slash + 1), isDir });
    if (isDir && !tree.has(relPath)) tree.set(relPath, []);
  }
  return ok(tree);
}
