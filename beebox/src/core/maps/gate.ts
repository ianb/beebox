/**
 * Preconditions shared by every refresh-maps entry point: whether the box is
 * in a state where maps can be computed, and which ignore patterns apply.
 *
 * The precheck (detection) and orphan pruning (deletion) both read the
 * committed tree, and both wait out a box with uncommitted user work — the
 * user may be mid-change, and pruning must not delete a MAP.md someone is
 * editing.
 */

import { isRepo, getStatus, hasCommits, gitBoxPrefix } from "../../lib/git.js";
import { BOX_DIRS } from "../../lib/paths.js";
import {
  DEFAULT_IGNORE_PATTERNS,
  SKELETON_HIDDEN_PATHS,
  loadUserIgnorePatterns,
} from "./precheck-ignore.js";

export type SkipReason = "uncommitted_work" | "not_a_repo" | "no_commits";

/**
 * Directories the engine writes while refresh-maps itself runs, so their
 * uncommitted changes are not the "uncommitted work" the gate waits out.
 * The procedure engine marks the step as running under procedure runs; the
 * refresh agent's own session appends to the usage session manifest before
 * its first tool call, so without this the agent's `--brief` always found a
 * dirty tree and returned no tasks. Excluding them is safe because every
 * listing reads the committed tree, not the disk.
 */
const ENGINE_WRITTEN_DIRS: readonly string[] = [BOX_DIRS.procedureRuns, BOX_DIRS.usage];

/** The effective map ignore patterns: defaults, skeleton-hidden paths, and `.bbx-maps-ignore`. */
export async function loadMapIgnorePatterns(boxRoot: string): Promise<readonly string[]> {
  const userPatterns = await loadUserIgnorePatterns(boxRoot);
  return [...DEFAULT_IGNORE_PATTERNS, ...SKELETON_HIDDEN_PATHS, ...userPatterns];
}

/** Why maps cannot be computed right now, or null when the box is workable. */
export async function unworkableReason(boxRoot: string): Promise<SkipReason | null> {
  if (!(await isRepo(boxRoot))) return "not_a_repo";
  if (!(await hasCommits(boxRoot))) return "no_commits";
  const status = await getStatus(boxRoot);
  // getStatus paths are repo-root-relative. On a box whose root is a repo
  // subdirectory they carry that prefix; strip it back to box-relative before
  // the ENGINE_WRITTEN_DIRS filter, or the filter never matches and
  // refresh-maps bails as `uncommitted_work` inside its own procedure step.
  const prefix = await gitBoxPrefix(boxRoot);
  const strip = (p: string): string => (prefix !== "" && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const dirty = [...status.staged, ...status.modified, ...status.untracked]
    .map(strip)
    .some((p) => !ENGINE_WRITTEN_DIRS.some((dir) => p.startsWith(`${dir}/`)));
  return dirty ? "uncommitted_work" : null;
}
