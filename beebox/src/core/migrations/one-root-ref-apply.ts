/**
 * Applies the `one-root` migration's ref rewriter (`one-root-ref-rewrite.ts`)
 * across the box: every migrated card/doc, then every never-moved view.
 * Split out of `one-root-run.ts` (which stays the orchestrator) purely to
 * keep that file under the repo's 300-line budget.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { rewriteOneRootRefs, rewriteOneRootViewRefs } from "./one-root-ref-rewrite.js";
import { rewriteOneRootViewDependencies } from "./one-root-view-dependencies.js";
import { preBrokenRefKey } from "./one-root-link-gate.js";
import { listBoxViewFiles } from "../list-cards.js";
import { isGitTracked, isGitIgnored, type PlannedMove, type RenamedEntry } from "./one-root-move-plan.js";

/** Ref-rewrite every migrated card/doc, using the mv plan to recover each
 * file's OLD content-relative path. Returns any unresolved ref tokens seen
 * (informational — the hard link gate is the real backstop) plus any
 * migrated card/doc PATH that was left untouched because it's a symlink.
 *
 * Finding 1 (round 4 hardening): `fs.readFile`/`writeFile` FOLLOW a symlink —
 * a tracked `.card`/`.md` entry that is itself a symlink (e.g.
 * `content/docs/alias.md -> ../../../shared.md`) would otherwise have its
 * REFERENT's bytes read and rewritten, which for a target resolving outside
 * the box is data corruption rollback cannot undo (the box's own git history
 * has no record of that external file). `lstat` each candidate first: a
 * symlinked card/doc is NEVER opened for rewrite — its ref content belongs
 * to its target. A target that also lives in the box is already rewritten
 * when ITS OWN move entry is inventoried; a target resolving OUTSIDE the box
 * is left byte-untouched (its refs may go stale — acceptable, and reported
 * back to the caller so the migration report can note it).
 *
 * Finding 6 (round 3 hardening): before overwriting an UNTRACKED move's
 * rewritten text, record its pre-rewrite bytes into the matching journal
 * entry (first rewrite only) — a `git mv`'d file needs no such record, since
 * `revertToSnapshot`'s `reset --hard` undoes an in-place content edit on a
 * tracked file for free.
 */
export async function rewriteRefs(params: {
  packageRoot: string;
  moves: PlannedMove[];
  journal: RenamedEntry[];
  oldPathExists: (v2ContentRelPath: string) => boolean;
}): Promise<{ unresolved: string[]; skippedSymlinks: string[]; preBrokenKeys: Set<string> }> {
  const unresolved: string[] = [];
  const skippedSymlinks: string[] = [];
  const preBrokenKeys = new Set<string>();
  const journalByNewAbs = new Map(params.journal.map((entry) => [entry.newAbs, entry]));
  for (const move of params.moves) {
    if (!move.newRelPath.endsWith(".card") && !move.newRelPath.endsWith(".md")) continue;
    const abs = path.join(params.packageRoot, move.newRelPath);
    const lst = await fs.lstat(abs);
    if (lst.isSymbolicLink()) {
      skippedSymlinks.push(move.newRelPath);
      continue;
    }
    const text = await fs.readFile(abs, "utf-8");
    const result = rewriteOneRootRefs({
      text,
      oldContentRelPath: move.contentRelPath,
      isCard: move.newRelPath.endsWith(".card"),
      oldPathExists: params.oldPathExists,
    });
    if (result.text !== text) {
      const journalEntry = journalByNewAbs.get(abs);
      if (journalEntry !== undefined && journalEntry.originalFileBytes === undefined) {
        journalEntry.originalFileBytes = text;
      }
      await fs.writeFile(abs, result.text);
    }
    for (const u of result.unresolved) unresolved.push(`${move.newRelPath}: ${u}`);
    for (const ref of result.preBrokenRefs) preBrokenKeys.add(preBrokenRefKey(move.newRelPath, ref));
  }
  return { unresolved, skippedSymlinks, preBrokenKeys };
}

/** A view never moves (same relative location in v2 and v3), but its
 * `cardRef="…"` refs still address the old v2 vocabulary — rewrite them in
 * place. Returns any unresolved ref tokens (the hard link gate's view check
 * is the real backstop) plus any view path left untouched because it's a
 * symlink.
 *
 * Finding 3 (round 5 hardening): `fs.readFile`/`writeFile` FOLLOW a symlink —
 * a `src/views/*.tsx` entry that is itself a symlink (e.g.
 * `src/views/Shared.tsx -> ../../../external/Shared.tsx`) would otherwise
 * have its REFERENT read and overwritten, the same data-corruption risk
 * {@link rewriteRefs} already guards against for cards/docs. Same policy
 * here: `lstat` each view path first and skip a symlinked leaf entirely — its
 * ref content belongs to its target, which is either rewritten under its own
 * move entry (if it lives in the box) or left byte-untouched (if it doesn't).
 *
 * Round-6 hardening finding 3: a view NEVER moves, so it has no
 * {@link PlannedMove} / journal entry the way an untracked card/doc gets one
 * in {@link rewriteRefs} — an untracked (including gitignored) view rewritten
 * in place here had no record of its pre-rewrite bytes, so a later rollback
 * (`revertToSnapshot`'s `reset --hard`, which only undoes TRACKED content)
 * left the migration's rewritten bytes sitting there instead of restoring
 * the original. Before overwriting an untracked view, append a `journal`
 * entry with `oldAbs === newAbs` (nothing renamed, only content changed) and
 * the pre-rewrite bytes — `rollbackMoveAndCommit` already restores any
 * journal entry's `originalFileBytes` after its (no-op, same-path) rename.
 */
export async function rewriteViewRefs(params: {
  packageRoot: string;
  journal: RenamedEntry[];
  oldPathExists: (v2ContentRelPath: string) => boolean;
}): Promise<{ unresolved: string[]; skippedSymlinks: string[]; preBrokenKeys: Set<string> }> {
  const { packageRoot, journal, oldPathExists } = params;
  const unresolved: string[] = [];
  const skippedSymlinks: string[] = [];
  const preBrokenKeys = new Set<string>();
  for (const viewPath of await listBoxViewFiles(packageRoot)) {
    const lst = await fs.lstat(viewPath);
    if (lst.isSymbolicLink()) {
      skippedSymlinks.push(path.relative(packageRoot, viewPath));
      continue;
    }
    const text = await fs.readFile(viewPath, "utf-8");
    const cardRefResult = rewriteOneRootViewRefs(text, oldPathExists);
    // Finding 4 (round 7 hardening): `dependencies` globs are a separate
    // ref-bearing form (see `rewriteOneRootViewDependencies`'s doc comment) —
    // applied to the cardRef-rewritten text so both land in one pass.
    const depsPath = path.relative(packageRoot, viewPath);
    const result = { ...rewriteOneRootViewDependencies(cardRefResult.text, depsPath), unresolved: cardRefResult.unresolved };
    if (result.text !== text) {
      if (!(await isGitTracked(packageRoot, viewPath))) {
        journal.push({ oldAbs: viewPath, newAbs: viewPath, wasIgnored: await isGitIgnored(packageRoot, viewPath), originalFileBytes: text });
      }
      await fs.writeFile(viewPath, result.text);
    }
    for (const u of result.unresolved) unresolved.push(`${path.relative(packageRoot, viewPath)}: ${u}`);
    for (const ref of cardRefResult.preBrokenRefs) preBrokenKeys.add(preBrokenRefKey(depsPath, ref));
  }
  return { unresolved, skippedSymlinks, preBrokenKeys };
}
