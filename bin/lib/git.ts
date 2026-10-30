/**
 * Run git from `bin/` scripts and read its output, with the failure mode
 * stated at every call:
 *
 * - `git(args, { onError: "throw" })`: a nonzero exit or a missing git
 *   throws, and git's stderr shows (the pre-commit tools rely on that as
 *   their only diagnostic).
 * - `git(args, { onError: "empty" })`: any failure returns ""; stderr is
 *   captured, not shown.
 * - `gitOrNull(args)`: any failure returns null; stderr is captured.
 *
 * Output keeps leading whitespace and loses one trailing newline only:
 * `git status --porcelain` puts status in the first two columns, and one is
 * routinely a space. Imports only `node:child_process`, because hook tools
 * start a fresh process on every commit.
 */

import { execFileSync, spawnSync } from "node:child_process";

interface GitOptions {
  cwd?: string | undefined;
  maxBuffer?: number;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}

/** Run git; `onError` says whether a failure throws (stderr shown) or reads as "" (stderr captured). */
export function git(args: string[], opts: GitOptions & { onError: "throw" | "empty" }): string {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  if (opts.onError === "throw") {
    return stripTrailingNewline(execFileSync("git", args, { encoding: "utf-8", cwd: opts.cwd, maxBuffer }));
  }
  return gitOrNull(args, opts) ?? "";
}

/** Run git; any failure returns null, with stderr captured rather than shown. */
export function gitOrNull(args: string[], opts: GitOptions): string | null {
  const result = spawnSync("git", args, { encoding: "utf-8", cwd: opts.cwd, maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER });
  return result.status === 0 ? stripTrailingNewline(result.stdout) : null;
}

/** The repository's top-level directory (`git rev-parse --show-toplevel`); throws outside a repository. */
export function gitTopLevel(cwd?: string): string {
  return git(["rev-parse", "--show-toplevel"], { cwd, onError: "throw" }).trim();
}

/** The shared `.git` directory of the checkout, absolute, the same from every worktree; throws outside a repository. */
export function gitCommonDir(cwd?: string): string {
  return git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, onError: "throw" }).trim();
}

/** The current branch name (`git rev-parse --abbrev-ref HEAD`; "HEAD" when detached); throws outside a repository. */
export function gitBranch(cwd?: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd, onError: "throw" }).trim();
}
