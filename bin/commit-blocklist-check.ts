#!/usr/bin/env node --import tsx
/**
 * Commit blocklist guard (`pnpm commit-blocklist-check`): blocks a commit whose
 * staged ADDITIONS contain any entry from a personal, gitignored blocklist. Run
 * by the monorepo pre-commit hook on every commit.
 *
 * Shared mechanism, personal list. This script is tracked so everyone gets the
 * guard; the strings it blocks live in a gitignored `.commit-blocklist` at the
 * repo root, so the sensitive values themselves (a purged domain, an IP,
 * personal names) never enter version control. `.commit-blocklist.example`
 * documents the format. No list => silent no-op (opt-in per developer). A
 * malformed/unreadable list => fail closed. If the list is somehow tracked, we
 * refuse (it must stay ignored — it holds exactly what you're blocking).
 *
 * Scans only staged additions (`git diff --cached -U0`, `+` lines) — catches
 * re-introduction without blocking commits over pre-existing content, and skips
 * binaries/deletions for free. It NEVER prints the matched value: doing so would
 * re-leak the purged secret into terminal/CI logs. It reports `file:line` plus
 * the blocklist entry's line number so you can look it up in your own list.
 *
 * Entry format (one per line): blank lines and `#` comments are skipped; an
 * entry matches as a case-insensitive literal substring; prefix with `re:` for a
 * case-insensitive regex (e.g. `re:\bJane Doe\b` for a word-bounded name). See
 * bin/CLAUDE.md.
 *
 * Note: a local hook is bypassable (`git commit --no-verify`); pair it with a
 * server-side check (GitHub push protection / CI) if that matters — see
 * bin/CLAUDE.md.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Thrown when the blocklist file is unparseable — surfaced as a fail-closed error. */
export class BlocklistError extends Error {
  override name = "BlocklistError";
}

export interface BlockEntry {
  /** 1-based line number of this entry in the blocklist file (for user reference). */
  line: number;
  /** True if the given text contains/matches this entry. */
  test: (text: string) => boolean;
}

/**
 * Parse blocklist text into matchers. Skips blank lines and `#` comments. A
 * `re:`-prefixed entry is a case-insensitive regex; anything else is a
 * case-insensitive literal substring (dots in domains/IPs are literal, not
 * regex). Throws BlocklistError on an invalid regex so the caller can fail closed.
 */
export function parseBlocklist(text: string): BlockEntry[] {
  const entries: BlockEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const line = i + 1;
    if (trimmed.startsWith("re:")) {
      const pattern = trimmed.slice(3);
      if (pattern === "") continue; // empty regex matches everything — treat as a comment
      let re: RegExp;
      try {
        re = new RegExp(pattern, "i");
      } catch (e) {
        throw new BlocklistError(`invalid regex on line ${line}: ${(e as Error).message}`);
      }
      entries.push({ line, test: (text) => re.test(text) });
    } else {
      const needle = trimmed.toLowerCase();
      entries.push({ line, test: (text) => text.toLowerCase().includes(needle) });
    }
  }
  return entries;
}

export interface AddedLine {
  file: string;
  lineno: number;
  text: string;
}

/**
 * Parse `git diff --cached -U0 --no-color` into the added (`+`) lines with their
 * new-file line numbers. Deletions and headers are ignored; binaries produce no
 * `+` lines and so are skipped naturally.
 */
export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file = "";
  let lineno = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      file = p === "/dev/null" ? "" : p.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      lineno = m ? Number(m[1]) : 0;
      continue;
    }
    if (line.startsWith("+")) {
      if (file !== "") added.push({ file, lineno, text: line.slice(1) });
      lineno++;
      continue;
    }
    // Deletions ('-') don't advance the new-file line number; everything else
    // ("diff --git", "index", "Binary files … differ") is ignored.
  }
  return added;
}

export interface Hit {
  file: string;
  lineno: number;
  /** The blocklist file line number that matched (never the value). */
  entry: number;
}

/** One hit per offending added line (first matching entry wins), value never captured. */
export function findBlocked(added: AddedLine[], entries: BlockEntry[]): Hit[] {
  const hits: Hit[] = [];
  for (const a of added) {
    for (const e of entries) {
      if (e.test(a.text)) {
        hits.push({ file: a.file, lineno: a.lineno, entry: e.line });
        break;
      }
    }
  }
  return hits;
}

function main(): void {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const rel = process.env.CB_COMMIT_BLOCKLIST ?? ".commit-blocklist";
  const blocklistPath = path.join(repoRoot, rel);

  let text: string;
  try {
    text = fs.readFileSync(blocklistPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return; // no list => opt-out, silent no-op
    console.error(`commit-blocklist-check: cannot read ${rel}: ${(e as Error).message}`);
    process.exit(1); // any other read failure => fail closed
  }

  let entries: BlockEntry[];
  try {
    entries = parseBlocklist(text);
  } catch (e) {
    console.error(`commit-blocklist-check: ${(e as Error).message}`);
    process.exit(1); // malformed list => fail closed
  }
  if (entries.length === 0) return;

  // The personal list must never be committed — it literally contains the
  // strings you're purging. Refuse if it's tracked (git grep/scanners would
  // otherwise read it, and it could ship).
  const tracked = execFileSync("git", ["ls-files", "--", rel], { cwd: repoRoot, encoding: "utf8" }).trim();
  if (tracked !== "") {
    console.error(`commit-blocklist-check: ${rel} is tracked by git — it must stay gitignored (it holds the very strings you block). Run: git rm --cached ${rel}`);
    process.exit(1);
  }

  const diff = execFileSync("git", ["diff", "--cached", "-U0", "--no-color"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const hits = findBlocked(parseAddedLines(diff), entries);
  if (hits.length > 0) {
    console.error("commit-blocklist-check failed — staged changes add blocklisted content:");
    for (const h of hits) console.error(`  ${h.file}:${h.lineno} (matches ${rel} line ${h.entry})`);
    console.error("The matched value is not printed (it would re-leak). To see which term:");
    console.error(`  sed -n '<N>p' ${rel}`);
    console.error("Fix the staged change. (git commit --no-verify bypasses this — don't.)");
    process.exit(1);
  }
}

// Run only as a script, not when imported by the test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("commit-blocklist-check.ts")) {
  main();
}
