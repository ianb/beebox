/**
 * Which dirty paths a process changed, from snapshots taken before and after it.
 *
 * `bbx trick` uses this to commit only a trick's own output: a path that was
 * already dirty before the run (someone's uncommitted edit) stays out of the
 * commit unless the run changed its content again.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { simpleGit } from "simple-git";
import { errnoCode } from "../../shared/error-guards.js";

/** Dirty path (boxRoot-relative) → fingerprint of its working-tree state. */
export type DirtySnapshot = ReadonlyMap<string, string>;

/**
 * List every path under boxRoot whose working tree or index differs from HEAD,
 * plus untracked files, as boxRoot-relative paths. Untracked directories are
 * expanded to their files (`-uall`); ignored files are omitted. A staged
 * rename or copy contributes both its source and destination.
 *
 * @param boxRoot - Repository root, or a directory below it as in a v2 box
 */
async function listDirtyPaths(boxRoot: string): Promise<string[]> {
  const git = simpleGit(boxRoot);
  // Porcelain paths are repo-root-relative whatever the cwd; strip the prefix
  // to return them in boxRoot's frame, which `stageAndCommitPaths` expects.
  const prefix = (await git.raw(["rev-parse", "--show-prefix"])).replace(/\n$/, "");
  const output = await git.raw(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  const fields = output.split("\0");
  const paths = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] ?? "";
    if (entry.length < 4) continue;
    const candidates = [entry.slice(3)];
    // `R`/`C` entries carry the source path as the next NUL-separated field.
    if (/^[CR]/.test(entry)) candidates.push(fields[++i] ?? "");
    for (const repoPath of candidates) {
      if (repoPath.startsWith(prefix) && repoPath.length > prefix.length) paths.add(repoPath.slice(prefix.length));
    }
  }
  return [...paths];
}

/** Content and mode of one path, or its absence. */
async function fingerprint(absPath: string): Promise<string> {
  let stat;
  try {
    stat = await fs.lstat(absPath);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return "missing";
    throw e;
  }
  if (stat.isSymbolicLink()) return `link:${await fs.readlink(absPath)}`;
  if (!stat.isFile()) return `other:${stat.mode.toString(8)}`;
  const hash = createHash("sha256");
  // Streamed: a dirty file can be large media the trick never touches.
  await pipeline(createReadStream(absPath), hash);
  return `file:${stat.mode.toString(8)}:${hash.digest("hex")}`;
}

/** Fingerprint every dirty path under boxRoot. */
export async function snapshotDirtyPaths(boxRoot: string): Promise<DirtySnapshot> {
  const snapshot = new Map<string, string>();
  for (const rel of await listDirtyPaths(boxRoot)) {
    snapshot.set(rel, await fingerprint(path.join(boxRoot, rel)));
  }
  return snapshot;
}

/**
 * Paths dirty in `after` that were clean in `before` or whose content changed
 * between the two. A path dirty in `before` but clean in `after` is omitted:
 * whoever cleaned it (a revert, or the process's own commit) left nothing to
 * commit.
 */
export function changedDirtyPaths(before: DirtySnapshot, after: DirtySnapshot): string[] {
  return [...after].filter(([rel, print]) => before.get(rel) !== print).map(([rel]) => rel).toSorted();
}
