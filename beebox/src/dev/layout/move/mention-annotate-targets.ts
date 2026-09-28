/**
 * `--annotate-from-git`'s literal-token targets: what text a mention could
 * spell, where it's allowed to match, and the canonical new repo-relative
 * path to embed in its note. Split out of `mention-annotate.ts` (which does
 * the actual text-insertion work) to stay under the file-size budget.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dirOf, isWithin } from "../graph.js";
import { gitLines } from "./git-ops.js";
import type { TokenKind } from "./mention-apply.js";
import type { DirectoryRename } from "./mention-directories.js";
import { directoryForms, fileForms } from "./mention-forms.js";
import type { PlannedMove } from "./list.js";

/**
 * `"any"` (repo-relative — every file), `"package"` (package-relative,
 * confined to files inside `scopeRoot`, same as the rewrite pass), or
 * `"outside-package"` — annotation-only: an unambiguous package-relative
 * token (`crossPackageTargets`) matched in a file that isn't inside ANY
 * package, where prefixing exactly one root reproduces a moved path.
 */
export type MatchScope = "any" | "package" | "outside-package";

export interface AnnotationTarget {
  /** The literal old-path text a mention could spell (repo-relative, package-relative, or an extension variant). */
  old: string;
  /** The canonical new REPO-RELATIVE path to embed in the note — never a package-relative or extension-swapped spelling. */
  newRepoRelative: string;
  kind: TokenKind;
  matchScope: MatchScope;
  /** The package root a `"package"`-scoped form is confined to; unused otherwise. */
  scopeRoot: string | null;
}

export function targetsForMove(move: PlannedMove, roots: string[]): AnnotationTarget[] {
  return fileForms({ move, roots }).map((form) => ({
    old: form.old,
    newRepoRelative: move.to,
    kind: "file",
    matchScope: form.scopeRoot === null ? "any" : "package",
    scopeRoot: form.scopeRoot,
  }));
}

export function targetsForDirectory(rename: DirectoryRename, roots: string[]): AnnotationTarget[] {
  return directoryForms({ rename, roots }).map((form) => ({
    old: form.old,
    newRepoRelative: rename.to,
    kind: "directory",
    matchScope: form.scopeRoot === null ? "any" : "package",
    scopeRoot: form.scopeRoot,
  }));
}

/** Every dir and ancestor (excluding the repo root) that some move's `from` sits under. */
function candidateAncestors(paths: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const path of paths) {
    let dir = dirOf(path);
    while (dir !== "" && !dirs.has(dir)) {
      dirs.add(dir);
      dir = dirOf(dir);
    }
  }
  return dirs;
}

/**
 * Annotation-only fix: `mention-directories.ts`'s `surveyDirectoryRenames`
 * decides a "uniform directory rename" by checking which files are
 * CURRENTLY tracked under the old directory — after the move already
 * happened (this mode's whole premise), that's always empty, so it never
 * fires. Instead this derives the rename from the mapping alone: old
 * directory `D` uniformly renamed to `D'` when every OLD PATH under `D` IN
 * THE MOVE MAPPING maps to `D'/<same relative suffix>`, and no tracked file
 * remains under `D` (so `D` isn't just coincidentally a prefix some
 * unrelated current file still uses). Left in this module rather than
 * `mention-directories.ts` so the rewrite pass's rules stay untouched.
 */
export function uniformDirectoryRenamesFromMapping(params: { repoRoot: string; moves: PlannedMove[] }): DirectoryRename[] {
  const renames: DirectoryRename[] = [];
  for (const dir of candidateAncestors(params.moves.map((m) => m.from))) {
    const under = params.moves.filter((m) => isWithin(m.from, dir));
    if (under.length <= 1) continue;
    const first = under[0];
    if (first === undefined) continue;
    const rest = first.from.slice(dir.length);
    if (!first.to.endsWith(rest)) continue;
    const newDir = first.to.slice(0, first.to.length - rest.length);
    const uniform = under.every((m) => m.to === newDir + m.from.slice(dir.length));
    if (!uniform) continue;
    const leftover = gitLines({ repoRoot: params.repoRoot, args: ["ls-files", "-z", "--", dir] });
    if (leftover.length > 0) continue;
    renames.push({ from: dir, to: newDir });
  }
  return renames;
}

/**
 * Every directory holding a `package.json` — a broader notion of "package"
 * than `roots` (`default-roots.ts` additionally requires a `src/` dir, since
 * that's what layout-check/the rewrite pass scan). A project like
 * `personal-vibe-check/` has no `src/` and so isn't a `roots` entry, but its
 * OWN docs still use generic example paths (`src/index.ts` in a Knip
 * how-to) that have nothing to do with a same-named path moved elsewhere in
 * the monorepo — treating it as "outside any package" would cross-package
 * match those coincidentally. Used only to gate the annotation-only
 * `"outside-package"` scope, never `"package"` scope (unchanged from the
 * rewrite pass).
 */
export function allPackageDirs(repoRoot: string): string[] {
  return [...new Set(gitLines({ repoRoot, args: ["ls-files", "-z", "--", "package.json", "*/package.json"] }).map(dirOf))].filter(
    (dir) => dir !== "",
  );
}

/**
 * Annotation-only fix: a package-relative mention in a file OUTSIDE any
 * package (an issue, a research note) is out of `targetsForMove`'s scope —
 * its `"package"` forms only fire inside the owning package. Here a
 * package-relative TOKEN (e.g. `src/lib/git.ts`) is annotated for such a
 * file when exactly one package root's move produced that literal token
 * AND no package currently has a real file at `<root>/<token>` (which would
 * make the mention's target genuinely ambiguous).
 */
export function crossPackageTargets(params: {
  repoRoot: string;
  moves: PlannedMove[];
  roots: string[];
  packageDirs: string[];
}): AnnotationTarget[] {
  const movesByToken = new Map<string, PlannedMove[]>();
  for (const move of params.moves) {
    for (const form of fileForms({ move, roots: params.roots })) {
      if (form.scopeRoot === null) continue; // repo-relative form, not this token
      const existing = movesByToken.get(form.old) ?? [];
      existing.push(move);
      movesByToken.set(form.old, existing);
    }
  }
  const targets: AnnotationTarget[] = [];
  for (const [token, moves] of movesByToken) {
    const distinctMoves = new Set(moves);
    if (distinctMoves.size !== 1) continue; // two packages' old paths share this token: ambiguous
    const [move] = distinctMoves;
    if (move === undefined) continue;
    const existsInAnyPackage = params.packageDirs.some((dir) => existsSync(join(params.repoRoot, dir, token)));
    if (existsInAnyPackage) continue;
    targets.push({ old: token, newRepoRelative: move.to, kind: "file", matchScope: "outside-package", scopeRoot: null });
  }
  return targets;
}
