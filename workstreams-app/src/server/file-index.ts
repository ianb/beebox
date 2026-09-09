// Every path the browser can open, for quick-open and the sidebar
// (beebox/docs/plans/general-browser.md, Track 3).
//
// This is the affordance that has to survive the consolidation. Replacing five
// reading surfaces with one is only an improvement if finding things gets
// EASIER; a browser without quick-open would trade five surfaces for one worse
// one, which is the opposite of the complaint it answers.
//
// The listing rule is ported from the doc browser (`workstreams-app/src/router/router-docs.ts:348-372`)
// rather than reinvented, including its deliberate exception: `.gitignore`
// keeps node_modules and build output out, and then IGNORED markdown under
// `scratch/` is re-admitted, because "scratch/ is exactly where agents leave
// deliverable orientation docs the boxholder wants to browse". What changes is
// the scope — every file, not only `.md`.

import { execa } from "execa";

import { kindForPath } from "./document-read.js";
import type { DocumentKind } from "../shared/documents.js";

export interface IndexedPath {
  relPath: string;
  kind: DocumentKind;
}

function splitLines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line !== "");
}

/**
 * Tracked plus untracked-but-not-ignored, which is what the developer thinks of
 * as "the files in this checkout". `--exclude-standard` is what keeps this from
 * being a hundred thousand node_modules entries.
 */
async function listedByGit(root: string): Promise<string[]> {
  const { stdout } = await execa(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  );
  return splitLines(stdout);
}

/**
 * The one deliberate exception to `.gitignore`. Scoped to `scratch/` and to
 * markdown so a stray build artifact cannot ride in with it — the same
 * narrowness the doc browser uses.
 */
async function scratchMarkdown(root: string): Promise<string[]> {
  try {
    const { stdout } = await execa(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "scratch/*.md", "scratch/**/*.md"],
      { cwd: root },
    );
    return splitLines(stdout);
  } catch (_e) {
    // No scratch/, or a git that would not answer. Not having scratch notes is
    // an ordinary state, not a failure worth surfacing.
    return [];
  }
}

/** Every browsable path in one checkout, sorted, deduplicated. */
export async function listBrowsablePaths(root: string): Promise<IndexedPath[]> {
  const [listed, scratch] = await Promise.all([listedByGit(root), scratchMarkdown(root)]);
  return [...new Set([...listed, ...scratch])]
    .toSorted()
    .map((relPath) => ({ relPath, kind: kindForPath(relPath) }));
}

/**
 * Subsequence match with a bias toward the basename — the behaviour every
 * quick-open has, and the reason typing `comstore` finds
 * `bin/lib/comments-store.ts`.
 *
 * Returns null when the query does not match at all, so a caller can filter and
 * rank in one pass.
 */
export function scorePath(relPath: string, query: string): number | null {
  if (query === "") return 0;
  const haystack = relPath.toLowerCase();
  const needle = query.toLowerCase();

  // A contiguous hit beats a scattered one, and a hit in the basename beats one
  // in a directory nobody was thinking about.
  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    const basenameAt = haystack.lastIndexOf("/") + 1;
    return direct >= basenameAt ? 1000 - direct : 500 - direct;
  }

  let position = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found === -1) return null;
    if (found > position) gaps += 1;
    position = found + 1;
  }
  return 100 - gaps;
}

/** The best matches for a query, most relevant first. */
export function searchPaths(
  paths: IndexedPath[],
  query: { text: string; limit: number },
): IndexedPath[] {
  const scored: Array<{ entry: IndexedPath; score: number }> = [];
  for (const entry of paths) {
    const score = scorePath(entry.relPath, query.text);
    if (score !== null) scored.push({ entry, score });
  }
  return scored
    .toSorted((a, b) => b.score - a.score || a.entry.relPath.length - b.entry.relPath.length)
    .slice(0, query.limit)
    .map((match) => match.entry);
}
