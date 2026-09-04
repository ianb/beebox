/**
 * The `one-root` migration's move-planning and move-execution half — split
 * out of `one-root-run.ts` (which stays the orchestrator) purely to keep
 * that file under the repo's 300-line budget. See its module doc comment
 * for the migration's overall shape; this module owns steps 1–2 (the
 * `content/` walk, the mapping dispatch, and the actual git-mv / filesystem
 * renames), including the tracked/untracked split (finding 1/3: a
 * git-tracked entry — including a tracked symlink, annex-style assets —
 * moves via `git mv`; anything untracked/gitignored, symlink or not, moves
 * via a recorded filesystem rename since `git mv` refuses anything not in
 * the index) and the `.gitignore` regression check (finding 3: a formerly-
 * ignored secret must stay ignored at its new path).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mapV2Path } from "./one-root-mapping.js";
import { OneRootPreflightError, OneRootGitignoreRegressionError } from "./one-root-errors.js";

const execFileAsync = promisify(execFile);

export interface PlannedMove {
  contentRelPath: string;
  newRelPath: string;
  /** Git-tracked (including a tracked symlink) moves via `git mv`; anything
   * else (untracked, gitignored — including an untracked symlink) moves via
   * a recorded filesystem rename. */
  tracked: boolean;
}

export interface RenamedEntry {
  oldAbs: string;
  newAbs: string;
  /** Whether `oldAbs` matched the OLD `.gitignore` rules — checked before the
   * regenerated v3 root `.gitignore` exists, so it can be compared against
   * the same check run at `newAbs` afterward ({@link verifyNoIgnoreRegression}). */
  wasIgnored: boolean;
}

/** `content/`-relative paths (forward-slashed) `git` already tracks, so
 * `planMoves` can route each entry to `git mv` (tracked) or a recorded
 * filesystem rename (everything else — untracked, gitignored). */
async function trackedContentRelPaths(params: { packageRoot: string; contentRoot: string }): Promise<Set<string>> {
  const contentRelRoot = path.relative(params.packageRoot, params.contentRoot).split(path.sep).join("/");
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--", contentRelRoot], {
    cwd: params.packageRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = new Set<string>();
  for (const entry of stdout.split("\0")) {
    if (entry === "") continue;
    out.add(entry.slice(contentRelRoot.length + 1));
  }
  return out;
}

/** Walk `content/` (skipping `.beebox/`) and map every file/symlink. Pure
 * planning pass — throws with the FULL unmapped/unsupported list before any
 * mutation happens. */
export async function planMoves(params: {
  packageRoot: string;
  contentRoot: string;
}): Promise<{ moves: PlannedMove[]; claudeMdMerge: boolean }> {
  const { contentRoot } = params;
  const tracked = await trackedContentRelPaths(params);
  const moves: PlannedMove[] = [];
  let claudeMdMerge = false;
  const unmapped: string[] = [];
  const unsupported: string[] = [];

  function planOne(contentRelPath: string): void {
    const mapped = mapV2Path(contentRelPath);
    switch (mapped.kind) {
      case "move":
        moves.push({ contentRelPath, newRelPath: mapped.newPath, tracked: tracked.has(contentRelPath) });
        break;
      case "merge-claude-md":
        claudeMdMerge = true;
        break;
      case "discard":
        break;
      case "unmapped":
        unmapped.push(contentRelPath);
        break;
    }
  }

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (dir === contentRoot && entry.name === ".beebox") continue;
      const abs = path.join(dir, entry.name);
      const contentRelPath = path.relative(contentRoot, abs).split(path.sep).join("/");
      // Check symlink-ness FIRST — a Dirent for a symlink reports false for
      // both isDirectory() and isFile() (it describes the link itself, not
      // its target), so without this check a symlinked file OR directory
      // silently falls through every branch below and is neither moved nor
      // walked into.
      if (entry.isSymbolicLink()) {
        planOne(contentRelPath);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile()) {
        planOne(contentRelPath);
        continue;
      }
      // Socket, FIFO, or block/character device — never produced by
      // ordinary box operation. Abort and name it rather than guess how to
      // move (or silently drop) something this unusual.
      unsupported.push(contentRelPath);
    }
  }
  await walk(contentRoot);

  if (unsupported.length > 0) {
    throw new OneRootPreflightError(
      `Found ${String(unsupported.length)} content/ entr${unsupported.length === 1 ? "y" : "ies"} of an ` +
        "unsupported type (socket/FIFO/device) — refusing to migrate rather than guess how to move it:\n  " +
        unsupported.join("\n  "),
    );
  }
  if (unmapped.length > 0) {
    throw new OneRootPreflightError(
      `Found ${String(unmapped.length)} content/ file(s) with no v3 mapping — refusing to migrate rather than ` +
        "guess or drop data. Reconcile by hand, then re-run:\n  " +
        unmapped.join("\n  "),
    );
  }
  return { moves, claudeMdMerge };
}

async function isGitIgnored(packageRoot: string, absPath: string): Promise<boolean> {
  const rel = path.relative(packageRoot, absPath);
  try {
    await execFileAsync("git", ["check-ignore", "-q", rel], { cwd: packageRoot });
    return true;
  } catch (_e) {
    // Exit 1 (not ignored) and any other failure both fold to "not
    // ignored" — fail CLOSED here: an uncertain answer must never be read
    // as "still ignored" for a path that used to be a secret.
    return false;
  }
}

export async function executeMoves(params: {
  packageRoot: string;
  contentRoot: string;
  moves: PlannedMove[];
}): Promise<{ untrackedRenames: RenamedEntry[] }> {
  const untrackedRenames: RenamedEntry[] = [];
  for (const move of params.moves) {
    const oldAbs = path.join(params.contentRoot, move.contentRelPath);
    const newAbs = path.join(params.packageRoot, move.newRelPath);
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    if (move.tracked) {
      await execFileAsync("git", ["mv", oldAbs, newAbs], { cwd: params.packageRoot });
      continue;
    }
    const wasIgnored = await isGitIgnored(params.packageRoot, oldAbs);
    await fs.rename(oldAbs, newAbs);
    untrackedRenames.push({ oldAbs, newAbs, wasIgnored });
  }
  return { untrackedRenames };
}

/** Refuse to commit if a formerly-ignored path (a secret, connector/schedule
 * state) landed somewhere the regenerated v3 `.gitignore` no longer covers —
 * call AFTER `initBox` has written that file. */
export async function verifyNoIgnoreRegression(params: {
  packageRoot: string;
  untrackedRenames: RenamedEntry[];
}): Promise<void> {
  const regressed: string[] = [];
  for (const renamed of params.untrackedRenames) {
    if (!renamed.wasIgnored) continue;
    if (!(await isGitIgnored(params.packageRoot, renamed.newAbs))) {
      regressed.push(path.relative(params.packageRoot, renamed.newAbs));
    }
  }
  if (regressed.length > 0) throw new OneRootGitignoreRegressionError(regressed);
}
