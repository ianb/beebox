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
 *
 * Two more hardening fixes live here:
 *  - **Destination-collision preflight** ({@link assertNoDestinationCollisions}):
 *    two different v2 sources (e.g. `content/docs/X` and
 *    `content/store/docs/X`, both defaulting into `_content/docs/X` —
 *    `mapStoreArea`'s free-form fallback) can map to the SAME v3 destination.
 *    Silently letting the second `rename`/`git mv` land on top of the first
 *    would destroy data with no error. Checked (case-insensitively, since a
 *    macOS box's filesystem is case-insensitive by default) before any move
 *    executes.
 *  - **Moved-symlink target remapping** ({@link remapMovedSymlinkTargets}): a
 *    RELATIVE symlink's target is interpreted relative to the link's own
 *    directory, so moving the link to a directory at a different depth (v2
 *    `content/store/drive/` is 3 levels below the package root; v3
 *    `_content/drive/` is 2) changes what the SAME relative text resolves
 *    to. An annex-style link (`../../../.git/annex/objects/…`) silently
 *    dangles unless its target text is recomputed for the new depth.
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
  await assertNoDestinationCollisions({ packageRoot: params.packageRoot, moves });
  return { moves, claudeMdMerge };
}

/**
 * Preflight: no two planned moves may land on the same v3 destination, and no
 * planned destination may already be occupied by an existing package-root
 * entry. Compared case-INsensitively — a macOS box's filesystem folds case,
 * so `_content/docs/X` and `_content/Docs/x` collide there even though the
 * strings differ. Throws naming every colliding source so the operator can
 * reconcile by hand rather than silently overwriting one with the other.
 */
async function assertNoDestinationCollisions(params: { packageRoot: string; moves: PlannedMove[] }): Promise<void> {
  const bySources = new Map<string, string[]>();
  for (const move of params.moves) {
    const key = move.newRelPath.toLowerCase();
    const sources = bySources.get(key) ?? [];
    sources.push(move.contentRelPath);
    bySources.set(key, sources);
  }

  const problems: string[] = [];
  for (const [key, sources] of bySources) {
    if (sources.length > 1) problems.push(`${key} <- ${sources.join(", ")}`);
  }
  for (const move of params.moves) {
    const newAbs = path.join(params.packageRoot, move.newRelPath);
    const occupied = await fs
      .lstat(newAbs)
      .then(() => true)
      .catch(() => false);
    if (occupied) problems.push(`${move.newRelPath} (from ${move.contentRelPath}) already exists at its destination`);
  }
  if (problems.length > 0) {
    throw new OneRootPreflightError(
      `Found ${String(problems.length)} v3 destination collision(s) — refusing to migrate rather than silently ` +
        "overwrite one source with another:\n  " +
        problems.join("\n  "),
    );
  }
}

/** Exported for {@link verifyNoBoxWideIgnoreRegression} in the sibling
 * `one-root-ignore-merge.ts` (finding 3's box-wide check reuses the exact
 * same fail-closed probe this module's own targeted check uses). */
export async function isGitIgnored(packageRoot: string, absPath: string): Promise<boolean> {
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

/**
 * Execute every planned move. `journal` is CALLER-OWNED — each untracked
 * rename is appended to it immediately after it succeeds, not batched up and
 * returned at the end. This is the fix for finding 1: if a later move in the
 * loop throws, a `try`/`catch` around the whole call only ever saw an empty
 * local array before (the assignment `untrackedRenames = await
 * executeMoves(...)` never ran), so rollback had no record of the renames
 * that DID land and could not undo them. With the journal passed in and
 * mutated in place, the caller's `catch` sees exactly what happened, however
 * far the loop got.
 */
export async function executeMoves(params: {
  packageRoot: string;
  contentRoot: string;
  moves: PlannedMove[];
  journal: RenamedEntry[];
}): Promise<void> {
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
    params.journal.push({ oldAbs, newAbs, wasIgnored });
  }
}

/**
 * Finding 4: recompute every moved symlink's RELATIVE target for its new
 * depth. A symlink's relative target is resolved against the link's own
 * directory, so moving `content/store/drive/photo-link.bin` (3 levels below
 * the package root) to `_content/drive/photo-link.bin` (2 levels below)
 * changes what an unchanged target string like `../../../.git/annex/objects/…`
 * resolves to — it now walks one level too far and dangles.
 *
 * The target may point at something that ALSO moved in this same migration
 * (a sibling asset, e.g. `photo-link.bin` → `photo.bin` in the same
 * directory) or at something that didn't (an annex object under `.git/`).
 * Both cases must resolve to the SAME real file after the move: this builds
 * an old-absolute-path → new-absolute-path map from every planned move
 * first, so a target that itself relocated is remapped to where it actually
 * landed, not to its now-nonexistent old location; a target outside the
 * moved set (old absolute path unchanged) is left as-is. Leaves an
 * absolute-target symlink (no depth dependency) and a target whose
 * recomputed relative text is unchanged (same depth, or the target moved
 * right along with the link into the same new directory) untouched. Must run
 * after {@link executeMoves} and before the ref rewrite / hard link gate,
 * since a dangling annex link would otherwise fail validation before annex
 * repair ever gets a chance.
 */
export async function remapMovedSymlinkTargets(params: {
  packageRoot: string;
  contentRoot: string;
  moves: PlannedMove[];
}): Promise<void> {
  const oldToNewAbs = new Map<string, string>();
  for (const move of params.moves) {
    oldToNewAbs.set(
      path.join(params.contentRoot, move.contentRelPath),
      path.join(params.packageRoot, move.newRelPath),
    );
  }

  for (const move of params.moves) {
    const oldAbs = path.join(params.contentRoot, move.contentRelPath);
    const newAbs = path.join(params.packageRoot, move.newRelPath);
    const lst = await fs.lstat(newAbs).catch(() => null);
    if (lst === null || !lst.isSymbolicLink()) continue;
    const target = await fs.readlink(newAbs);
    if (path.isAbsolute(target)) continue; // Depth-independent — nothing to remap.
    const resolvedOldTarget = path.resolve(path.dirname(oldAbs), target);
    // If the target itself moved in this same migration, its real new
    // location is where IT landed — not its now-nonexistent old path.
    const resolvedFinalTarget = oldToNewAbs.get(resolvedOldTarget) ?? resolvedOldTarget;
    const remapped = path.relative(path.dirname(newAbs), resolvedFinalTarget);
    if (remapped === target) continue;
    await fs.unlink(newAbs);
    await fs.symlink(remapped, newAbs);
  }
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
