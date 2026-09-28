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
 * A `git grep` pattern list is chunked before it hits the command line: a
 * move list in the thousands (a whole-repo `--mentions-from-git` pass)
 * produces thousands of literal patterns, which both risks the OS argument
 * length limit and — via `-e` repeated that many times — makes git's own
 * matching slower than a few separate calls. Also drops any empty-string
 * pattern (a real bug elsewhere, not something to hand to `git grep`,
 * which would otherwise match every line of every file).
 */
const MAX_PATTERNS_PER_GREP_CALL = 500;

function chunkPatterns(patterns: string[]): string[][] {
  const nonEmpty = patterns.filter((p) => p.length > 0);
  const chunks: string[][] = [];
  for (let i = 0; i < nonEmpty.length; i += MAX_PATTERNS_PER_GREP_CALL) {
    chunks.push(nonEmpty.slice(i, i + MAX_PATTERNS_PER_GREP_CALL));
  }
  return chunks;
}

function runGrepAny(params: { repoRoot: string; patterns: string[]; listFilesOnly: boolean }): string[] {
  const lines = new Set<string>();
  for (const chunk of chunkPatterns(params.patterns)) {
    const patternArgs = chunk.flatMap((pattern) => ["-e", pattern]);
    try {
      const out = execFileSync("git", ["grep", params.listFilesOnly ? "-l" : "-n", "-F", ...patternArgs, "--"], {
        cwd: params.repoRoot,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
      for (const line of out.split("\n")) if (line.length > 0) lines.add(line);
    } catch (e) {
      if (grepExitStatus(e) === 1) continue;
      throw e;
    }
  }
  return [...lines];
}

/**
 * Tracked file paths containing at least one of `patterns` (literal,
 * non-regex, OR-matched) — a handful of `git grep` calls for many patterns,
 * so a mention-rewrite pass with dozens (or thousands) of forms doesn't
 * spawn a subprocess per form. `[]` for an empty pattern list (git would
 * otherwise match every file).
 */
export function gitGrepFilesAny(params: { repoRoot: string; patterns: string[] }): string[] {
  if (params.patterns.length === 0) return [];
  return runGrepAny({ repoRoot: params.repoRoot, patterns: params.patterns, listFilesOnly: true });
}

/**
 * `path:line:content` lines matching at least one of `patterns` (literal,
 * non-regex, OR-matched) — the multi-pattern counterpart to `gitGrep`,
 * used to fetch every candidate "needs review" line for every moved path
 * in one pass instead of one `git grep` per moved path.
 */
export function gitGrepLinesAny(params: { repoRoot: string; patterns: string[] }): string[] {
  if (params.patterns.length === 0) return [];
  return runGrepAny({ repoRoot: params.repoRoot, patterns: params.patterns, listFilesOnly: false });
}
