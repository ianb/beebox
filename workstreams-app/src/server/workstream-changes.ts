// Which workstreams have touched which files — the cross-workstream lens
// (beebox/docs/plans/general-browser.md, Track 3a).
//
// One piece of data, read in both directions:
//
//   file      -> workstreams   "changed in: scanner-ingest, dev-comments",
//                              so you learn it from the FILE rather than from
//                              a merge conflict.
//   workstream -> files        the `?workstream=` filter, without the browser
//                              becoming a per-workstream browser.
//
// It also feeds the comment routing ladder (document-comments.md, Track 4a):
// exactly one modifying workstream is inferred, several take the most recent.
//
// THREE SOURCES, matching issue-overlay.ts, because "changed" has to include
// work in progress — a branch's committed diff alone would miss what someone is
// doing right now, which is the case you most want to see.
//
// UNAVAILABLE IS NOT NONE. A workstream whose diff fails is reported as
// unavailable rather than contributing nothing, because "no workstream changed
// this" and "we could not find out" are different answers and must not look
// alike (engineering principle 4).

import { execa } from "execa";

/** What a scan found, in both directions plus what it could not answer. */
export interface WorkstreamChanges {
  /** Repository-relative path -> the workstreams that changed it. */
  byPath: Map<string, string[]>;
  /** Workstream -> the paths it changed. */
  byWorkstream: Map<string, string[]>;
  /** Workstreams whose diff could not be read, with the reason. */
  unavailable: Map<string, string>;
}

export function emptyChanges(): WorkstreamChanges {
  return { byPath: new Map(), byWorkstream: new Map(), unavailable: new Map() };
}

function splitZ(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry !== "");
}

/**
 * Everything this worktree has changed relative to main: committed on its
 * branch, uncommitted in its tree, and untracked-but-present. `main...HEAD` is
 * the merge-base form, so a stale branch does not report every file main has
 * moved on since.
 */
async function changedPaths(root: string): Promise<string[]> {
  const run = (args: string[]) => execa("git", args, { cwd: root });
  const [committed, uncommitted, untracked] = await Promise.all([
    run(["diff", "--name-only", "-z", "main...HEAD"]),
    run(["diff", "--name-only", "-z", "HEAD"]),
    run(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [
    ...splitZ(committed.stdout),
    ...splitZ(uncommitted.stdout),
    ...splitZ(untracked.stdout),
  ];
}

/**
 * Scan every live worktree. One `git diff` per workstream per snapshot period —
 * a handful of subprocesses a minute at the observed number of workstreams. If
 * that ever stops being cheap, the answer is a longer cache TTL, not a cleverer
 * cache.
 */
export async function collectWorkstreamChanges(
  worktreeRoots: Map<string, string>,
): Promise<WorkstreamChanges> {
  const result = emptyChanges();
  const scans = await Promise.all(
    [...worktreeRoots].map(async ([name, root]) => {
      try {
        return { name, paths: await changedPaths(root), problem: null };
      } catch (e) {
        // A worktree mid-cull, a broken checkout, a git that refuses: all
        // reportable, none of them "this workstream changed nothing".
        return { name, paths: [], problem: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  for (const scan of scans.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (scan.problem !== null) {
      result.unavailable.set(scan.name, scan.problem);
      continue;
    }
    const unique = [...new Set(scan.paths)].toSorted();
    result.byWorkstream.set(scan.name, unique);
    for (const relPath of unique) {
      result.byPath.set(relPath, [...(result.byPath.get(relPath) ?? []), scan.name]);
    }
  }
  return result;
}

/** The workstreams that changed one path, in a stable order. */
export function workstreamsForPath(changes: WorkstreamChanges, relPath: string): string[] {
  return changes.byPath.get(relPath) ?? [];
}
