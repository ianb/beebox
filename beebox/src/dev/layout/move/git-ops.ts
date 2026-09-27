/**
 * The `git` operations the move tool needs: listing tracked paths, moving a
 * file, and grepping for lingering mentions. Kept separate from
 * `default-roots.ts`'s own tiny `git` helper since that one is check-only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../shared/is-record.js";
import { dirOf } from "../graph.js";

export function gitLines(params: { repoRoot: string; args: string[] }): string[] {
  const out = execFileSync("git", params.args, { cwd: params.repoRoot, encoding: "utf8" });
  return out.split("\0").filter((s) => s.length > 0);
}

/** The subset of `paths` that `git ls-files` reports as tracked. */
export function gitTrackedFiles(params: { repoRoot: string; paths: string[] }): Set<string> {
  if (params.paths.length === 0) return new Set();
  return new Set(gitLines({ repoRoot: params.repoRoot, args: ["ls-files", "-z", "--", ...params.paths] }));
}

/** `git mv`, creating the destination directory first (`git mv` requires it to exist). */
export function gitMove(params: { repoRoot: string; from: string; to: string }): void {
  const targetDir = join(params.repoRoot, dirOf(params.to));
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  execFileSync("git", ["mv", params.from, params.to], { cwd: params.repoRoot });
}

function grepExitStatus(e: unknown): number | undefined {
  if (!isRecord(e)) return undefined;
  const status = e["status"];
  return typeof status === "number" ? status : undefined;
}

/** `path:line:content` lines matching a literal (non-regex) pattern; `[]` on no match. */
export function gitGrep(params: { repoRoot: string; pattern: string }): string[] {
  try {
    const out = execFileSync("git", ["grep", "-n", "-F", "--", params.pattern], {
      cwd: params.repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\n").filter((s) => s.length > 0);
  } catch (e) {
    if (grepExitStatus(e) === 1) return [];
    throw e;
  }
}

/**
 * Tracked file paths containing at least one of `patterns` (literal,
 * non-regex, OR-matched) — one `git grep` call for many patterns, so a
 * mention-rewrite pass with dozens of forms doesn't spawn a subprocess per
 * form. `[]` for an empty pattern list (git would otherwise match every file).
 */
export function gitGrepFilesAny(params: { repoRoot: string; patterns: string[] }): string[] {
  if (params.patterns.length === 0) return [];
  const patternArgs = params.patterns.flatMap((pattern) => ["-e", pattern]);
  try {
    const out = execFileSync("git", ["grep", "-l", "-F", ...patternArgs, "--"], {
      cwd: params.repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\n").filter((s) => s.length > 0);
  } catch (e) {
    if (grepExitStatus(e) === 1) return [];
    throw e;
  }
}
