/**
 * The `one-root` migration's rollback path — split out of `one-root-run.ts`
 * (which stays the orchestrator) purely to keep that file under the repo's
 * 300-line budget. Called from `moveAndCommitBox`'s `catch` when any step
 * before the final commit throws.
 *
 * Finding 1 (Track E hardening review, round 3): a rollback that can't
 * fully restore the pre-migration tree must STOP — not fall through to the
 * destructive cleanup tail (stray package-root entry removal, `git clean
 * -fd` via `revertToSnapshot`), which would delete whatever landed at a
 * destination a failed restore step left stranded (e.g. a gitignored
 * secret, or `.beebox` itself, never renamed back). Every restoration step
 * is attempted best-effort; ANY failure throws {@link OneRootRollbackError}
 * naming every preserved path instead of running the cleanup tail.
 *
 * Finding 6: an UNTRACKED entry the migration modified IN PLACE after the
 * move (a symlink target recomputed for its new depth, or an untracked
 * card/doc rewritten by the ref rewriter) needs its ORIGINAL bytes restored
 * after the rename-back — the rename alone puts the file back at its old
 * path, but with the migration's post-move content, not what was there
 * before the migration touched it. `RenamedEntry.originalLinkTarget` /
 * `.originalFileBytes` (set by `one-root-move-plan.ts` and
 * `one-root-run.ts`'s `rewriteRefs`, the first time each entry is modified)
 * carry that original.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { revertToSnapshot } from "../../lib/git.js";
import { errorMessage, toError } from "../../lib/error-guards.js";
import type { RenamedEntry } from "./one-root-move-plan.js";
import { OneRootRollbackError } from "./one-root-errors.js";

/** The v2 package root's closed vocabulary (never formalized as data the way
 * `BOX_ROOT_VOCABULARY` is for v3 — this migration is the one place that
 * needs it, so it's inlined here rather than resurrecting a whole v2 spec
 * module for one check). Exported for `one-root-run.ts`'s preflight check —
 * one set, not two hand-kept in sync. */
export const V2_PACKAGE_ROOT_VOCABULARY = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "tsconfig.json",
  "node_modules",
  ".git",
  ".gitignore",
  ".gitattributes",
  "CLAUDE.md",
  ".claude",
  "src",
  "content",
  "README.md",
  "views",
  ".DS_Store",
]);

/**
 * Undo everything `moveAndCommitBox` did before it threw `error`, then
 * either throw {@link OneRootRollbackError} (a restoration step failed —
 * the tree is left exactly as the failed restore left it) or run the
 * destructive cleanup tail and rethrow `error` (every restoration
 * succeeded). Always throws — never returns normally.
 */
export async function rollbackMoveAndCommit(params: {
  packageRoot: string;
  contentRoot: string;
  preSha: string;
  beeboxMoved: boolean;
  originalMarkerBytes: string | null;
  originalHistoryBytes: string | null;
  untrackedRenames: RenamedEntry[];
  error: unknown;
}): Promise<never> {
  const { packageRoot, contentRoot, preSha, beeboxMoved, originalMarkerBytes, originalHistoryBytes, untrackedRenames, error } = params;
  const restorationFailures: string[] = [];

  for (const renamed of untrackedRenames.toReversed()) {
    await fs.mkdir(path.dirname(renamed.oldAbs), { recursive: true }).catch(() => {
      // Best effort — the rename attempt right below reports if this
      // still leaves the restore incomplete.
    });
    const renamedBack = await fs
      .rename(renamed.newAbs, renamed.oldAbs)
      .then(() => true)
      .catch((renameErr: unknown) => {
        restorationFailures.push(
          `${renamed.newAbs} could not be renamed back to ${renamed.oldAbs} (${errorMessage(renameErr)}) — ` +
            `left in place at ${renamed.newAbs}`,
        );
        console.error(
          `one-root migration rollback: failed to rename ${renamed.newAbs} back to ${renamed.oldAbs} ` +
            `(${errorMessage(renameErr)}) — PRESERVING ${renamed.newAbs}; manual recovery needed.`,
        );
        return false;
      });
    if (!renamedBack) continue; // Nothing landed at oldAbs to restore content into.

    // Captured to a local const before each closure below — TS doesn't
    // carry a property's narrowed (`!== undefined`) type into a nested
    // callback, only a local binding's.
    if (renamed.originalLinkTarget !== undefined) {
      const originalTarget = renamed.originalLinkTarget;
      await fs
        .unlink(renamed.oldAbs)
        .then(() => fs.symlink(originalTarget, renamed.oldAbs))
        .catch((restoreErr: unknown) => {
          restorationFailures.push(
            `${renamed.oldAbs}: failed to restore its original symlink target (${errorMessage(restoreErr)})`,
          );
          console.error(
            `one-root migration rollback: failed to restore the original symlink target at ${renamed.oldAbs} ` +
              `(${errorMessage(restoreErr)}) — manual recovery needed.`,
          );
        });
    } else if (renamed.originalFileBytes !== undefined) {
      const originalBytes = renamed.originalFileBytes;
      await fs.writeFile(renamed.oldAbs, originalBytes).catch((restoreErr: unknown) => {
        restorationFailures.push(
          `${renamed.oldAbs}: failed to restore its original file content (${errorMessage(restoreErr)})`,
        );
        console.error(
          `one-root migration rollback: failed to restore the original content at ${renamed.oldAbs} ` +
            `(${errorMessage(restoreErr)}) — manual recovery needed.`,
        );
      });
    }
  }

  if (beeboxMoved) {
    // contentRoot itself may already be gone (rm -rf'd once every real file
    // had moved out of it) — recreate it before renaming .beebox back, or
    // the rename fails with ENOENT on a missing parent and silently strands
    // .beebox at the package root.
    await fs.mkdir(contentRoot, { recursive: true }).catch(() => {
      // Best effort — the rename attempt right below reports if this still
      // leaves contentRoot unusable.
    });
    const beeboxRenamedBack = await fs
      .rename(path.join(packageRoot, ".beebox"), path.join(contentRoot, ".beebox"))
      .then(() => true)
      .catch((renameErr: unknown) => {
        restorationFailures.push(
          `.beebox could not be renamed back from ${packageRoot} to ${contentRoot} (${errorMessage(renameErr)}) ` +
            `— left in place at ${path.join(packageRoot, ".beebox")}`,
        );
        console.error(
          `one-root migration rollback: failed to rename .beebox back (${errorMessage(renameErr)}) — manual recovery needed.`,
        );
        return false;
      });
    // Neither box.json nor chat-session-history.json is git-tracked (both
    // live under the gitignored `.beebox/`), so `revertToSnapshot` below
    // cannot undo their in-place mutation — restore the bytes captured
    // before `bumpMarker`/`rewriteChatBindings` touched them. Without this
    // a retried `bbx migrate` sees shapeVersion 3 already and refuses
    // (`probeV2Box` treats >= 3 as "not a v2 box"). Only attempted when
    // `.beebox` actually made it back under `contentRoot` — writing these
    // bytes into a location `.beebox` never reached would just create a
    // second, wrong copy.
    if (beeboxRenamedBack) {
      if (originalMarkerBytes !== null) {
        await fs.writeFile(path.join(contentRoot, ".beebox", "box.json"), originalMarkerBytes).catch((writeErr: unknown) => {
          restorationFailures.push(`box.json marker restore failed (${errorMessage(writeErr)})`);
          console.error(
            `one-root migration rollback: failed to restore the original box.json marker (${errorMessage(writeErr)}) — manual recovery needed.`,
          );
        });
      }
      if (originalHistoryBytes !== null) {
        await fs
          .writeFile(path.join(contentRoot, ".beebox", "chat-session-history.json"), originalHistoryBytes)
          .catch((writeErr: unknown) => {
            restorationFailures.push(`chat-session-history.json restore failed (${errorMessage(writeErr)})`);
            console.error(
              `one-root migration rollback: failed to restore the original chat-session-history.json (${errorMessage(writeErr)}) — manual recovery needed.`,
            );
          });
      }
    }
  }

  if (restorationFailures.length > 0) {
    throw new OneRootRollbackError({ failures: restorationFailures, cause: error });
  }

  // Every restoration above succeeded — safe to run the destructive cleanup
  // tail. `initBox` (run before the ref rewrite/link gate) writes NEW,
  // previously-nonexistent top-level entries at packageRoot — the v3
  // `.gitignore`/`.gitattributes` and underscore areas (`_tmp/`, `_config/`,
  // …). Once that `.gitignore` exists, plain `git clean -f -d` below (via
  // `revertToSnapshot`, untracked-but-NOT-ignored files only) removes the
  // .gitignore itself but leaves whatever it now ignores (`_tmp/`) behind —
  // stranding a retry at the closed-vocabulary preflight check. Remove
  // every such stray explicitly, by name, before the shared revert runs.
  // Scoped to packageRoot's own top level (never touches `content/`, which
  // the restores above already made right) and to entries outside the v2
  // vocabulary, so it can never remove something the box's OWN preflight
  // already required to be there.
  const survivors = await fs.readdir(packageRoot).catch(() => []);
  for (const name of survivors) {
    if (name === "content" || V2_PACKAGE_ROOT_VOCABULARY.has(name)) continue;
    const entryAbs = path.join(packageRoot, name);
    await fs.rm(entryAbs, { recursive: true, force: true }).catch((rmErr: unknown) => {
      console.error(
        `one-root migration rollback: failed to remove stray package-root entry ${name} ` +
          `(${errorMessage(rmErr)}) — manual recovery needed.`,
      );
    });
  }
  await revertToSnapshot(packageRoot, preSha);
  throw toError(error);
}
