// What changed recently, anywhere — the browser's front door
// (beebox/docs/plans/general-browser.md, Track 3).
//
// The boxholder's rule: "a file is interesting if it has been modified
// recently, in any workstream." That is a FEED, not a listing, and it is a
// different structure from a directory tree — which is why the browser opens on
// this rather than on a file tree.
//
// The computation generalizes working code from the retired /dev/docs
// browser, which derived per-file times from `git log --format=%ct
// --name-only` and fell back to filesystem mtime for untracked files, with the
// reasoning recorded in place: untracked files "were created after the
// worktree clone, not shared at clone time like tracked files — so fall back
// to it, which floats in-progress docs to the top." That reasoning holds here
// for the same reason; what changes is that this runs across every checkout
// and is not scoped to `.md`.
//
// BOUNDED BY A WINDOW. `git log` over all of history for every file would cost
// far more than the answer is worth, and a recency feed does not want it: the
// question is "what changed lately", so the log is asked for lately.

import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { kindForPath } from "./document-read.js";
import type { DocumentKind } from "../shared/documents.js";

/** How far back the feed looks. A month covers "what has this project been doing". */
export const RECENCY_WINDOW = "30 days ago";

/** How many entries a feed returns before it is truncated (and says so). */
export const RECENCY_LIMIT = 200;

export interface RecentFile {
  relPath: string;
  kind: DocumentKind;
  /** Epoch seconds of the most recent change seen in this checkout. */
  at: number;
  /** Which checkout it changed in: a workstream name, or null for main. */
  workstream: string | null;
  /** True when the change is uncommitted or the file is untracked. */
  inProgress: boolean;
}

export interface RecentFeed {
  /** When this feed was computed, epoch seconds. Relative times render against it. */
  now: number;
  files: RecentFile[];
  /** How many recent files each checkout contributed — "how much work comes from where". */
  distribution: Array<{ workstream: string | null; count: number }>;
  /** Checkouts whose scan failed. Reported, never counted as quiet. */
  unavailable: Map<string, string>;
  /** True when the feed was cut at RECENCY_LIMIT, so the UI can say so. */
  truncated: boolean;
}

function splitZ(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry !== "");
}

/**
 * Tracked files, newest commit first. `--name-only` with a `%ct` header line per
 * commit gives one pass; the first time a path appears is its most recent
 * change, so later mentions are ignored.
 *
 * SCOPE IS THE POINT. A worktree shares main's history, so asking it for
 * "everything in the last 30 days" returns main's month over again — with 20
 * live worktrees that is 20 copies of the same commits, wearing 20 different
 * workstream labels, and a distribution that says every workstream did the same
 * amount of work. A branch is asked only for what is ITS OWN (`main..HEAD`);
 * main is asked for the window.
 */
async function committedTimes(root: string, scope: { branchOnly: boolean }): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  // BOTH bounds for a branch. `main..HEAD` keeps it from re-reporting main's
  // history; `--since` keeps a months-old unmerged worktree from filling a
  // RECENT feed with commits nobody has touched since. Either alone is wrong.
  const range = scope.branchOnly
    ? ["main..HEAD", `--since=${RECENCY_WINDOW}`]
    : [`--since=${RECENCY_WINDOW}`];
  const { stdout } = await execa(
    "git",
    ["log", ...range, "--format=%ct", "--name-only", "--no-renames"],
    { cwd: root },
  );
  let current = 0;
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    if (/^\d+$/u.test(line)) {
      current = Number(line);
      continue;
    }
    if (!times.has(line)) times.set(line, current);
  }
  return times;
}

/**
 * Uncommitted edits and untracked files, timed by filesystem mtime. These are
 * the in-progress ones, and they are the reason the feed is worth opening:
 * committed history alone shows what someone finished, not what they are doing.
 */
async function workingTreeTimes(root: string): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  const run = (args: string[]) => execa("git", args, { cwd: root });
  const [modified, untracked] = await Promise.all([
    run(["diff", "--name-only", "-z", "HEAD"]),
    run(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const candidates = [...new Set([...splitZ(modified.stdout), ...splitZ(untracked.stdout)])];
  await Promise.all(
    candidates.map(async (relPath) => {
      // A path can vanish between the listing and the stat (a build cleaning
      // up, a cull in flight). That is not an error, it is a file that is no
      // longer interesting.
      const stats = await fs.stat(path.join(root, relPath)).catch(() => null);
      if (stats !== null) times.set(relPath, Math.floor(stats.mtimeMs / 1000));
    }),
  );
  return times;
}

async function scanCheckout(root: string, workstream: string | null): Promise<RecentFile[]> {
  const [committed, working] = await Promise.all([
    committedTimes(root, { branchOnly: workstream !== null }),
    workingTreeTimes(root),
  ]);
  const files: RecentFile[] = [];
  for (const [relPath, at] of committed) {
    if (working.has(relPath)) continue; // the working-tree time is newer and wins
    files.push({ relPath, kind: kindForPath(relPath), at, workstream, inProgress: false });
  }
  for (const [relPath, at] of working) {
    files.push({ relPath, kind: kindForPath(relPath), at, workstream, inProgress: true });
  }
  return files;
}

/**
 * The aggregate feed across main and every live worktree.
 *
 * One entry per (path, checkout) pair rather than per path: the same file
 * changed on two branches is genuinely two things to look at, and collapsing
 * them would hide the second.
 */
export async function collectRecentFiles(params: {
  mainRoot: string;
  worktreeRoots: Map<string, string>;
  limit?: number;
  now?: () => number;
}): Promise<RecentFeed> {
  const limit = params.limit ?? RECENCY_LIMIT;
  const clock = params.now ?? (() => Math.floor(Date.now() / 1000));
  const checkouts: Array<[string | null, string]> = [
    [null, params.mainRoot],
    ...[...params.worktreeRoots].map(([name, root]): [string | null, string] => [name, root]),
  ];

  const unavailable = new Map<string, string>();
  const scans = await Promise.all(
    checkouts.map(async ([workstream, root]) => {
      try {
        return await scanCheckout(root, workstream);
      } catch (e) {
        // A checkout mid-cull or a git that refuses is reportable, not quiet.
        unavailable.set(workstream ?? "main", e instanceof Error ? e.message : String(e));
        return [];
      }
    }),
  );

  const all = scans.flat().toSorted((a, b) => b.at - a.at || a.relPath.localeCompare(b.relPath));
  const distribution = [...checkouts]
    .map(([workstream]) => ({
      workstream,
      count: all.filter((file) => file.workstream === workstream).length,
    }))
    .filter((entry) => entry.count > 0)
    .toSorted((a, b) => b.count - a.count);

  return {
    now: clock(),
    files: all.slice(0, limit),
    distribution,
    unavailable,
    truncated: all.length > limit,
  };
}
