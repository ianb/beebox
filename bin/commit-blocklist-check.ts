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
 * Entry format (one per line), blanks and `#` comments skipped:
 *   - `foo`            block: case-insensitive literal substring.
 *   - `re:<pattern>`   block: case-insensitive regex (e.g. `re:\bJane Doe\b`).
 *   - `!foo` / `!re:…` ALLOW (gitignore-style): un-blocks a match whose span sits
 *                      inside the allow match's span, so you can block broadly and
 *                      carve out a legit use (block `Marlowe`, `!@marlowe`).
 *                      A blocked term elsewhere on the line still fires.
 *   - `file:<glob>`    IGNORE a whole file — skip scanning paths matching the glob
 *                      (`*` within a segment, `**` across; a glob with no `/`
 *                      matches by basename at any depth, so `file:package.json`
 *                      exempts every package.json). Coarse: it blinds the guard to
 *                      the whole file, so prefer a `!` allow for a specific token.
 * See bin/CLAUDE.md.
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
  constructor(message: string) {
    super(message);
    this.name = "BlocklistError";
  }
}

/** A `re:` entry whose pattern the RegExp engine rejects. */
class InvalidBlocklistRegexError extends BlocklistError {
  constructor(line: number, detail: string) {
    // The engine's message repeats the whole pattern, which is the blocked
    // vocabulary itself; keep only the reason after it.
    super(`invalid regex on line ${line}: ${detail.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, "")}`);
    this.name = "InvalidBlocklistRegexError";
  }
}

/** The message of an unknown thrown value, without asserting it is an Error. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Narrow a caught value to a Node syscall error, which carries a string `code`. */
function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

/** All [start, end) match spans of an entry within one line of text. */
type SpanFn = (text: string) => Array<[number, number]>;

export type Entry =
  | { line: number; kind: "block"; spans: SpanFn }
  | { line: number; kind: "allow"; spans: SpanFn }
  | { line: number; kind: "ignore"; matchesFile: (repoPath: string) => boolean };

function literalSpans(needle: string): SpanFn {
  const n = needle.toLowerCase();
  return (text) => {
    const hay = text.toLowerCase();
    const out: Array<[number, number]> = [];
    for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + 1)) {
      out.push([i, i + n.length]);
    }
    return out;
  };
}

function regexSpans(pattern: string, line: number): SpanFn {
  let re: RegExp;
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- a `re:` entry IS a user-authored regex by contract (bin/CLAUDE.md); escaping it would change the feature's meaning. The source is the developer's own gitignored .commit-blocklist, read locally.
    re = new RegExp(pattern, "gi");
  } catch (e) {
    throw new InvalidBlocklistRegexError(line, errorMessage(e));
  }
  return (text) => {
    const out: Array<[number, number]> = [];
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || m[0].length === 0) continue; // skip zero-width
      out.push([m.index, m.index + m[0].length]);
    }
    return out;
  };
}

/** Translate a `file:` glob (`*` within a segment, `**` across `/`) to an anchored regex. */
function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- `re` is built above one character at a time, with every regex metacharacter escaped and only `*` translated, so no glob character reaches the engine unescaped.
  return new RegExp(`^${re}$`);
}

function fileMatcher(glob: string): (repoPath: string) => boolean {
  const hasSlash = glob.includes("/");
  const re = globToRegex(glob);
  return (repoPath) => {
    if (re.test(repoPath)) return true;
    if (!hasSlash) return re.test(repoPath.slice(repoPath.lastIndexOf("/") + 1)); // basename at any depth
    return false;
  };
}

/**
 * Parse blocklist text into rules. Skips blank lines and `#` comments. `file:`
 * marks a whole-file ignore glob; `!` marks an allow rule; `re:` marks a
 * case-insensitive regex; otherwise the entry is a case-insensitive literal
 * substring. Throws BlocklistError on an invalid regex so the caller fails closed.
 */
export function parseBlocklist(text: string): Entry[] {
  const entries: Entry[] = [];
  const lines = text.split("\n");
  for (const [i, line_] of lines.entries()) {
    let body = line_!.trim();
    if (body === "" || body.startsWith("#")) continue;
    const line = i + 1;
    if (body.startsWith("file:")) {
      const glob = body.slice(5).trim();
      if (glob !== "") entries.push({ line, kind: "ignore", matchesFile: fileMatcher(glob) });
      continue;
    }
    let allow = false;
    if (body.startsWith("!")) {
      allow = true;
      body = body.slice(1).trim();
    }
    if (body === "") continue; // bare `!` — nothing to allow
    let spans: SpanFn;
    if (body.startsWith("re:")) {
      const pattern = body.slice(3);
      if (pattern === "") continue; // empty regex matches everything — treat as a comment
      spans = regexSpans(pattern, line);
    } else {
      spans = literalSpans(body);
    }
    entries.push({ line, kind: allow ? "allow" : "block", spans });
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

/**
 * A managed worktree does not receive the gitignored personal blocklist. Use a
 * worktree-local file when present, otherwise share the main checkout's file
 * beside Git's common directory. Absolute overrides remain absolute.
 */
export function blocklistCandidates(options: { repoRoot: string; rel: string; commonDir: string }): string[] {
  const { repoRoot, rel, commonDir } = options;
  if (path.isAbsolute(rel)) return [rel];
  const local = path.join(repoRoot, rel);
  const mainCheckout = path.join(path.dirname(commonDir), rel);
  return local === mainCheckout ? [local] : [local, mainCheckout];
}

/** True if a block span sits entirely inside one of the allow spans. */
function covered([bs, be]: [number, number], allowSpans: Array<[number, number]>): boolean {
  return allowSpans.some(([as, ae]) => as <= bs && be <= ae);
}

/**
 * One hit per offending added line (first un-allowed block match wins). Files
 * matching a `file:` ignore rule are skipped entirely; a block match is
 * suppressed when an allow rule's span covers it, so an allowed token can't be
 * exploited to smuggle a blocked one elsewhere on the line.
 */
export function findBlocked(added: AddedLine[], entries: Entry[]): Hit[] {
  const blocks = entries.filter((e): e is Extract<Entry, { kind: "block" }> => e.kind === "block");
  const allows = entries.filter((e): e is Extract<Entry, { kind: "allow" }> => e.kind === "allow");
  const ignores = entries.filter((e): e is Extract<Entry, { kind: "ignore" }> => e.kind === "ignore");
  const hits: Hit[] = [];
  for (const a of added) {
    if (ignores.some((g) => g.matchesFile(a.file))) continue;
    const allowSpans = allows.flatMap((e) => e.spans(a.text));
    let hit: Hit | null = null;
    for (const b of blocks) {
      for (const span of b.spans(a.text)) {
        if (!covered(span, allowSpans)) {
          hit = { file: a.file, lineno: a.lineno, entry: b.line };
          break;
        }
      }
      if (hit) break;
    }
    if (hit) hits.push(hit);
  }
  return hits;
}

function main(): void {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const rel = process.env.BBX_COMMIT_BLOCKLIST ?? ".commit-blocklist";
  const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const candidates = blocklistCandidates({ repoRoot, rel, commonDir });

  let text = "";
  let blocklistPath = "";
  for (const candidate of candidates) {
    try {
      text = fs.readFileSync(candidate, "utf8");
      blocklistPath = candidate;
      break;
    } catch (e) {
      if (isErrnoException(e) && e.code === "ENOENT") continue;
      console.error(`commit-blocklist-check: cannot read ${candidate}: ${errorMessage(e)}`);
      process.exit(1); // any other read failure => fail closed
    }
  }
  if (blocklistPath === "") return; // no list in this worktree or main => opt-out

  let entries: Entry[];
  try {
    entries = parseBlocklist(text);
  } catch (e) {
    console.error(`commit-blocklist-check: ${errorMessage(e)}`);
    process.exit(1); // malformed list => fail closed
  }
  if (entries.every((e) => e.kind !== "block")) return; // no block rules => nothing to enforce

  // The personal list must never be committed — it literally contains the
  // strings you're purging. Refuse if it's tracked.
  const tracked = path.isAbsolute(rel)
    ? ""
    : execFileSync("git", ["ls-files", "--", rel], { cwd: repoRoot, encoding: "utf8" }).trim();
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
    for (const h of hits) console.error(`  ${h.file}:${h.lineno} (matches ${blocklistPath} line ${h.entry})`);
    console.error("The matched value is not printed (it would re-leak). To see which term:");
    console.error(`  sed -n '<N>p' ${blocklistPath}`);
    console.error("Fix it, or add a `!`-allow (specific token) or `file:` ignore (whole file). (--no-verify bypasses — don't.)");
    process.exit(1);
  }
}

// Run only as a script, not when imported by the test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("commit-blocklist-check.ts")) {
  main();
}
