/**
 * The git questions the ledger and the selector both ask: what changed, and
 * what exact working state am I looking at.
 *
 * Shared because the two must agree. A selector computing its change set
 * differently from the ledger recording it would make every `implicated`
 * figure a comparison between two different questions.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, Tracks 2 and 5
 * and the 2026-08-25 revision (mechanism B).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { parsePorcelainEntries } from "./test-ledger-lib.js";

/**
 * Strips only the trailing newline, never leading whitespace: `git status
 * --porcelain` encodes status in the first two columns, and one of them is
 * routinely a space.
 */
export const git = (args: string[], cwd?: string): string =>
  execFileSync("git", args, { encoding: "utf-8", cwd, maxBuffer: 64 * 1024 * 1024 }).replace(
    /\n$/,
    "",
  );

const gitBytes = (args: string[], cwd?: string): Buffer =>
  execFileSync("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });

export function gitCommonDir(cwd?: string): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf-8",
    cwd,
  }).trim();
}

/**
 * `--untracked-files=all` is load-bearing in both callers below.
 *
 * Plain `git status --porcelain` collapses a wholly-untracked directory into a
 * single `?? dir/` entry. That breaks two different things: a new test
 * directory reads as one unaccounted path (so every test in it is invisible to
 * `implicated`, and the whole change reads as unaccounted), and — worse —
 * adding another file inside that directory does not change the status output,
 * so `treeHash` would call two genuinely different working states identical
 * and the flake derivation would compare across them.
 */
export const porcelain = (cwd?: string): string =>
  git(["status", "--porcelain", "-z", "--untracked-files=all"], cwd);

/** Changed paths versus a base ref (default `main`), plus anything uncommitted. */
export function changedPaths(input: { base?: string; cwd?: string } = {}): string[] {
  const base = input.base ?? "main";
  const committed = git(["diff", "--name-only", `${base}...HEAD`], input.cwd).split("\n");
  const dirty = parsePorcelainEntries(porcelain(input.cwd)).map((entry) => entry.path);
  return [...new Set([...committed, ...dirty].filter((p) => p !== ""))].sort();
}

/**
 * Identifies the exact working state by CONTENT, so a re-run with no edits is
 * detectable and an edit is never mistaken for one.
 *
 * An earlier version hashed the porcelain *text*, which names dirty files but
 * says nothing about what is in them: fail → edit that same file → pass kept
 * one hash, and `deriveFlakes` (test-ledger-lib.ts) called a real fix a flake.
 * Under full runs that was tolerable noise; with selected runs the flake
 * derivation is the only flake signal there is.
 *
 * Content is the HEAD tree, plus `git diff HEAD` (tracked changes, staged and
 * not, hashed as bytes so a binary edit counts), plus the blob hash of every
 * untracked-not-ignored file.
 */
export function treeHash(cwd?: string): string {
  const parts = [
    `tree:${git(["rev-parse", "HEAD^{tree}"], cwd)}`,
    `diff:${sha256(gitBytes(["diff", "HEAD", "--binary"], cwd))}`,
    ...untrackedBlobs(cwd),
  ];
  return hashParts(parts);
}

/** `?? path` entries, hashed with `git hash-object` — content, not just names. */
function untrackedBlobs(cwd?: string): string[] {
  const paths = parsePorcelainEntries(porcelain(cwd))
    .filter((entry) => entry.status === "??")
    .map((entry) => entry.path)
    .filter((path) => existsSync(cwd === undefined ? path : `${cwd}/${path}`));
  const blobs: string[] = [];
  // Chunked: an untracked build directory can hold thousands of paths, and one
  // argv has a limit. A path that vanishes mid-call (a test's temp file, say)
  // takes the whole chunk down, so failures fall back to naming the file —
  // never to silently hashing the same as before the file existed.
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200);
    try {
      const hashes = git(["hash-object", "--", ...chunk], cwd).split("\n");
      chunk.forEach((path, index) => blobs.push(`blob:${hashes[index] ?? "?"}:${path}`));
    } catch {
      for (const path of chunk) blobs.push(`unhashable:${path}`);
    }
  }
  return blobs;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Order-independent, so the caller never has to think about sort stability. */
function hashParts(parts: string[]): string {
  return `sha256:${sha256([...parts].sort().join("\n")).slice(0, 16)}`;
}
