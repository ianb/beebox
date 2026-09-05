#!/usr/bin/env node --import tsx
/**
 * Home-directory leak guard (`pnpm path-leak-check`): exits nonzero if any
 * tracked file contains a real personal home path (`/Users/<name>/...` or
 * `/home/<name>/...`). Run by the monorepo pre-commit hook on every commit.
 *
 * Why: this repo is going source-available (GPLv3). Auto-generated audit
 * reports and hand-written docs kept leaking the author's home directory
 * because agents paste whatever the ambient environment hands them — the Read
 * tool requires absolute paths and a worktree's cwd is absolute, so an
 * "Evidence: <file>" citation carries the full `/Users/<name>/src/...` prefix.
 * There is no single generator to fix (reports come from ad-hoc multi-agent
 * workflows), so this generator-agnostic guard is the durable backstop. See
 * issues/2026-07-05-report-workflows-emit-relative-paths.md.
 *
 * Fail-closed: a name that isn't a known service account or placeholder trips
 * the guard. Fix a violation, don't suppress it — use a repo-relative path, or
 * `~/...` for a home-relative one in prose. The `/Users/me` and `/Users/you`
 * placeholders are allowed for `file:` URL examples, where `~` doesn't resolve.
 */

import { execFileSync } from "node:child_process";

// Names that are NOT a personal-home leak. `~/...` needs no entry — it never
// matches the pattern below. A real macOS/Linux username (`/Users/janedoe`,
// `/home/janedoe`) is not here, so it trips the guard.
export const ALLOWED_NAMES = new Set([
  // Deploy service-account homes, hardcoded across deploy/ and its docs. Not a
  // personal-identity leak (the guard's real target) — just a scrappy deploy
  // detail, exempt so those real paths don't trip the hook. Not a blessed
  // public interface; if the deploy stops hardcoding these, drop them.
  "beebox",
  "bbx-test1",
  // Fictional placeholders used in docs, schema examples, and test fixtures.
  "me",
  "you",
  "user",
  "x",
]);

// Files exempt entirely (path relative to repo root). Prefer scrubbing a leak
// to `~`/placeholder over adding an entry here; keep this near-empty.
export const ALLOWED_FILES = new Set<string>();

// A real home path: `/Users/<name>/` or `/home/<name>/`, capturing the name.
// Requires the trailing slash so a bare web route like `/home` never matches.
const HOME_PATH = /\/(?:Users|home)\/([\dA-Za-z][\w.-]*)\//g;

// The `git grep` prefilter: any line mentioning either home prefix. Precise
// matching + allowlisting happens in findLeaks so it stays pure and testable.
export const GREP_PREFILTER = "/(Users|home)/[A-Za-z0-9]";

// Scan `git grep -nI` output for personal-home leaks. Each input line is
// `path:lineno:content`; returns one message per offending path segment.
export function findLeaks(grepOutput: string): string[] {
  const problems: string[] = [];
  for (const line of grepOutput.split("\n")) {
    if (line === "") continue;
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    if (first === -1 || second === -1) continue;
    const file = line.slice(0, first);
    if (ALLOWED_FILES.has(file)) continue;
    const lineno = line.slice(first + 1, second);
    const content = line.slice(second + 1);
    for (const match of content.matchAll(HOME_PATH)) {
      const name = match[1];
      if (name === undefined || ALLOWED_NAMES.has(name)) continue;
      problems.push(`home path leak: ${file}:${lineno} -> ${match[0]}`);
    }
  }
  return problems;
}

/** The `status` a failed `execFileSync` carries, when it carries one. */
function exitStatusOf(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null || !("status" in e)) return undefined;
  return typeof e.status === "number" ? e.status : undefined;
}

function main(): void {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

  // `-I` skips binary files; `-n` prefixes line numbers. A no-match `git grep`
  // exits 1, which execFileSync throws on — treat that as "clean".
  let raw = "";
  try {
    raw = execFileSync("git", ["grep", "-nIE", GREP_PREFILTER], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    if (exitStatusOf(e) !== 1) throw e; // 1 = no matches; anything else is a real failure
  }

  const problems = findLeaks(raw);
  if (problems.length > 0) {
    console.error("path-leak-check failed:");
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      "Use a repo-relative path, or `~/...` for a home-relative one (`/Users/me` · `/Users/you` are allowed for file: URL examples).",
    );
    process.exit(1);
  }
}

// Run only as a script, not when imported by the test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("path-leak-check.ts")) {
  main();
}
