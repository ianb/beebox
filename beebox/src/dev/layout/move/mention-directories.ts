/**
 * Detects a directory rename hiding inside a move list: a move list moves
 * files, but configs often name a directory (`"scripts/migrate/"`). When
 * EVERY tracked file under a directory moves to the same new directory
 * with the same relative structure, that directory itself counts as
 * renamed and its mentions are rewritten too (`mention-forms.ts`
 * `directoryForms`). Every OTHER directory that contains a moved file
 * (an ancestor whose files only partly move, or move to inconsistent
 * places) is reported instead: `nonUniform` names it so the caller can
 * surface any mention of it as "needs review" without rewriting.
 */
import { dirOf } from "../graph.js";
import { gitLines } from "./git-ops.js";
import type { PlannedMove } from "./list.js";

export interface DirectoryRename {
  from: string;
  to: string;
}

export interface DirectoryRenameSurvey {
  renames: DirectoryRename[];
  /**
   * Directories worth reporting (not rewriting) as a mention: each move's
   * OWN immediate directory, when it isn't already covered by a uniform
   * rename. Deliberately narrower than every ancestor a rename could have
   * used — a coarse ancestor (`beebox/src`) sits above countless unrelated
   * files and would flag every mention that merely shares its prefix, not
   * a genuine directory reference like `scripts/migrate/`.
   */
  nonUniform: string[];
}

function gitTrackedUnder(params: { repoRoot: string; dir: string }): string[] {
  return gitLines({ repoRoot: params.repoRoot, args: ["ls-files", "-z", "--", params.dir] });
}

/** `dir` and every ancestor up to (excluding) the repo root. */
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

/** Whether every tracked file under `dir` moves to `newDir` with the same relative suffix. */
function isUniformRename(params: {
  dir: string;
  newDir: string;
  trackedUnderDir: string[];
  moveMap: ReadonlyMap<string, string>;
}): boolean {
  for (const file of params.trackedUnderDir) {
    const to = params.moveMap.get(file);
    const expected = params.newDir + file.slice(params.dir.length);
    if (to === undefined || to !== expected) return false;
  }
  return true;
}

/** The rename this directory would have, if its first tracked file's move is consistent with one; `null` otherwise. */
function renameCandidate(params: { dir: string; trackedUnderDir: string[]; moveMap: ReadonlyMap<string, string> }): DirectoryRename | null {
  const first = params.trackedUnderDir[0];
  if (first === undefined) return null;
  const firstMove = params.moveMap.get(first);
  if (firstMove === undefined) return null;
  const rest = first.slice(params.dir.length);
  if (!firstMove.endsWith(rest)) return null;
  const newDir = firstMove.slice(0, firstMove.length - rest.length);
  return { from: params.dir, to: newDir };
}

export function surveyDirectoryRenames(params: { repoRoot: string; moves: PlannedMove[] }): DirectoryRenameSurvey {
  const moveMap = new Map(params.moves.map((m) => [m.from, m.to] as const));
  const renames: DirectoryRename[] = [];
  const renamed = new Set<string>();
  for (const dir of candidateAncestors(params.moves.map((m) => m.from))) {
    const trackedUnderDir = gitTrackedUnder({ repoRoot: params.repoRoot, dir });
    // A single-file directory isn't meaningfully a directory for mention
    // purposes — any mention of it is really a mention of that one file,
    // already covered by `fileForms`. Treating it as a rename too would
    // double-rewrite (the file form runs first, then the directory form
    // would match the already-rewritten path's own prefix).
    if (trackedUnderDir.length <= 1) continue;
    const candidate = renameCandidate({ dir, trackedUnderDir, moveMap });
    if (candidate !== null && isUniformRename({ dir, newDir: candidate.to, trackedUnderDir, moveMap })) {
      renames.push(candidate);
      renamed.add(dir);
    }
  }
  const immediateDirs = new Set(
    params.moves.map((m) => dirOf(m.from)).filter((dir) => gitTrackedUnder({ repoRoot: params.repoRoot, dir }).length > 1),
  );
  const nonUniform = [...immediateDirs].filter((dir) => dir !== "" && !renamed.has(dir));
  return { renames, nonUniform };
}

export function detectDirectoryRenames(params: { repoRoot: string; moves: PlannedMove[] }): DirectoryRename[] {
  return surveyDirectoryRenames(params).renames;
}
