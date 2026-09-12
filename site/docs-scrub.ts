// The scrub gate (plan: "The scrub gate"): a mechanical scan every promoted,
// generated, and authored doc passes through before it reaches dist/docs/. A
// hit fails the build naming file and line — nothing is silently dropped or
// auto-fixed. Reuses the two guards already enforced on every commit rather
// than re-deriving their patterns.

import fs from "node:fs";
import path from "node:path";
import { ALLOWED_NAMES, HOME_PATH } from "../bin/path-leak-check.js";
import { execFileSync } from "node:child_process";
import { blocklistCandidates, findBlocked, parseBlocklist, type Entry } from "../bin/commit-blocklist-check.js";

export class ScrubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrubError";
  }
}

const LITERAL_PATTERNS = ["private-issues"] as const;

// A named box under a boxes directory: `~/src/boxes/<name>`, `~/src/box-worktrees/<name>/…`,
// or the server's `/home/<user>/boxes/<name>`. The directory itself is a public
// convention (it is in the root README); a NAME after it is a real box unless it
// is the shared test box, a tooling subfolder, or an obvious placeholder.
const BOX_PATH = /(?:~|\$HOME|\/home\/[^\s/]+|\/Users\/[^\s/]+)\/(?:src\/(?:boxes|box-worktrees)|boxes)\/([^\s"')/`]+)/g;
// The shared test box, tooling subfolders, the fictional roster in
// beebox/docs/example-names.md, and generic example names.
const ALLOWED_BOX_NAMES = new Set(["test1", "scenarios", "backups", "field-runs", "hearth", "ledger", "studio", "seminar", "hearth-test"]);
const PLACEHOLDER_BOX_NAME = /^(?:<|{|\$|my-?box|example|your-?box|dev\d*$|box\d*$)/;

function isPlaceholderBoxName(name: string): boolean {
  return ALLOWED_BOX_NAMES.has(name) || PLACEHOLDER_BOX_NAME.test(name);
}

// Cached per process: the blocklist is a single developer file that doesn't
// change mid-build. Every entry kind is kept so `findBlocked` honors the
// file's own `!` allows and `file:` ignores, exactly as the commit hook does.
let cachedBlockEntries: Entry[] | undefined;

/**
 * The same lookup the commit hook uses: a worktree-local `.commit-blocklist`
 * first, else the main checkout's copy beside git's common dir. A managed
 * worktree never receives the gitignored personal file, so reading only
 * `<repoRoot>/.commit-blocklist` would silently disable the guard there.
 */
function blocklistPaths(repoRoot: string): string[] {
  let commonDir: string;
  try {
    commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_e) {
    return [path.join(repoRoot, ".commit-blocklist")]; // not a git checkout (tests): local file only
  }
  return blocklistCandidates({ repoRoot, rel: ".commit-blocklist", commonDir });
}

function loadBlockEntries(repoRoot: string): Entry[] {
  if (cachedBlockEntries !== undefined) return cachedBlockEntries;
  let text = "";
  for (const candidate of blocklistPaths(repoRoot)) {
    try {
      text = fs.readFileSync(candidate, "utf8");
      break;
    } catch (_e) {
      continue; // absent here; try the next candidate
    }
  }
  cachedBlockEntries = parseBlocklist(text);
  return cachedBlockEntries;
}

export interface ScrubOptions {
  sourceLabel: string;
  repoRoot: string;
  /**
   * Also scan against the developer's gitignored `.commit-blocklist`. On for
   * authored docs (prose this corpus introduces). Off for promoted and
   * generated docs: their text already passed the commit hook's staged-addition
   * scan when it entered the repo, and a whole-file rescan trips on English
   * words that collide with a personal regex (an ordinary noun in an API
   * contract). The path and box-name patterns above still apply to every kind.
   */
  blocklist: boolean;
}

/**
 * Scan `content` line by line for a real leak, throwing `ScrubError` naming
 * `sourceLabel:line` on the FIRST hit (fail-closed, one line, no stack noise).
 */
export function scrubText(content: string, options: ScrubOptions): void {
  const { sourceLabel, repoRoot, blocklist } = options;
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    const lineno = index + 1;
    for (const match of line.matchAll(HOME_PATH)) {
      const name = match[1];
      if (name !== undefined && !ALLOWED_NAMES.has(name)) {
        throw new ScrubError(`${sourceLabel}:${lineno} home path leak: ${match[0]}`);
      }
    }
    for (const match of line.matchAll(BOX_PATH)) {
      const name = match[1];
      if (name !== undefined && !isPlaceholderBoxName(name)) {
        throw new ScrubError(`${sourceLabel}:${lineno} names a box: ${match[0]}`);
      }
    }
    for (const pattern of LITERAL_PATTERNS) {
      if (line.includes(pattern)) {
        throw new ScrubError(`${sourceLabel}:${lineno} disallowed reference: "${pattern}"`);
      }
    }
  }
  if (!blocklist) return;
  const added = lines.map((text, index) => ({ file: sourceLabel, lineno: index + 1, text }));
  const hit = findBlocked(added, loadBlockEntries(repoRoot))[0];
  if (hit !== undefined) {
    throw new ScrubError(`${sourceLabel}:${hit.lineno} matches .commit-blocklist entry (line ${hit.entry})`);
  }
}

/** Test-only: drop the cached blocklist so a test can point at a fresh repoRoot. */
export function resetScrubCacheForTests(): void {
  cachedBlockEntries = undefined;
}
