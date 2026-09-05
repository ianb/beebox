/**
 * Finding 3 (Track E hardening review, round 2): `initBox`'s `.gitignore`/
 * `.gitattributes` regen (`box/index.ts`) REPLACES both files wholesale. A v2
 * box can carry custom rules in TWO places that discards outright:
 *  - the package-root `.gitignore`/`.gitattributes` (npm-package-relative
 *    rules, e.g. a hand-added `src/tricks/private.env`) — `initBox`
 *    overwrites these unconditionally, every run;
 *  - the operational-root `content/.gitignore`/`content/.gitattributes` —
 *    `one-root-mapping.ts` classifies both `discard` (superseded by the
 *    regenerated v3 versions), so nothing carries their custom lines forward
 *    at all.
 *
 * Fix, part 1 ({@link captureIgnoreRules} + {@link mergeIgnoreRules}): snapshot
 * every rule from all four files BEFORE `initBox` runs, then after it has
 * written the fresh v3 files, append whatever custom rule isn't already
 * covered — under a clearly marked "migrated local rules" section. A
 * content-root-relative rule is remapped through `mapV2Path` to its
 * v3-relative equivalent where that succeeds; one `mapV2Path` can't resolve
 * (free text, or naming something outside the v2 content vocabulary) is
 * carried forward UNCHANGED rather than dropped — a dead rule that matches
 * nothing is a far smaller risk than silently losing coverage over a secret.
 *
 * Fix, part 2 ({@link snapshotBoxWideIgnored} + {@link verifyNoBoxWideIgnoreRegression}):
 * `one-root-move-plan.ts`'s `verifyNoIgnoreRegression` only re-checks the
 * entries THIS migration recorded as untracked renames. This is the box-wide
 * extension the review called for: inventory EVERY path `git status
 * --ignored` reports at preflight (before anything moves), and re-check every
 * one of them post-migration — catching a regression the targeted check would
 * miss, e.g. a whole ignored directory whose v3-mapped rule doesn't cover it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { errnoCode } from "../../lib/error-guards.js";
import { mapV2Path } from "./one-root-mapping.js";
import { isGitIgnored } from "./one-root-move-plan.js";
import { OneRootGitignoreRegressionError, OneRootPreflightError } from "./one-root-errors.js";

const execFileAsync = promisify(execFile);

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** Non-comment, non-blank lines, trailing whitespace trimmed — the unit both
 * the capture and the "already covered" comparison operate on. */
function ruleLines(text: string | null): string[] {
  if (text === null) return [];
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

export interface IgnoreSnapshot {
  packageGitignoreRules: string[];
  packageGitattributesRules: string[];
  contentGitignoreRules: string[];
  contentGitattributesRules: string[];
}

/** Capture every custom rule from both halves' `.gitignore`/`.gitattributes`
 * BEFORE `initBox` overwrites the package-root pair and the residual
 * `content/` tree gets `rm -rf`'d. Call early — before {@link executeMoves}
 * mutates anything. */
export async function captureIgnoreRules(params: { packageRoot: string; contentRoot: string }): Promise<IgnoreSnapshot> {
  const [packageGitignore, packageGitattributes, contentGitignore, contentGitattributes] = await Promise.all([
    readIfExists(path.join(params.packageRoot, ".gitignore")),
    readIfExists(path.join(params.packageRoot, ".gitattributes")),
    readIfExists(path.join(params.contentRoot, ".gitignore")),
    readIfExists(path.join(params.contentRoot, ".gitattributes")),
  ]);
  return {
    packageGitignoreRules: ruleLines(packageGitignore),
    packageGitattributesRules: ruleLines(packageGitattributes),
    contentGitignoreRules: ruleLines(contentGitignore),
    contentGitattributesRules: ruleLines(contentGitattributes),
  };
}

/**
 * Single-character C-style escapes git's `unquote_c_style` recognizes inside
 * a quoted `.gitignore`/`.gitattributes` pattern token, keyed by the
 * character right after the backslash.
 */
const SINGLE_CHAR_ESCAPES: Readonly<Record<string, string>> = {
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  '"': '"',
};

/**
 * Decode a git C-style-quoted token starting at `text[0]` (a `"`). Finding 5
 * (round 4 hardening): `splitAttributesLine`'s old plain `/^(\S+)/` split
 * broke on a quoted pattern containing a space — `"docs/My Draft.bin" -diff`
 * split at the FIRST whitespace, landing inside the quotes (pattern
 * `"docs/My`, attrs ` Draft.bin" -diff`), so the mapping silently failed and
 * the stale v2 rule was carried forward unchanged while the real file moved
 * out from under it. This decodes the backslash escapes git itself supports
 * for a quoted pattern (`\\`, `\"`, the single-character C escapes, and
 * three-digit octal `\NNN`) and returns the point in `text` right after the
 * closing quote. Returns `null` on an unterminated quote or an escape this
 * decoder doesn't recognize — the caller must ABORT rather than guess at a
 * quoting form it can't round-trip.
 */
function decodeCQuotedToken(text: string): { value: string; endIndex: number } | null {
  if (text[0] !== '"') return null;
  let value = "";
  let i = 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return { value, endIndex: i + 1 };
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) return null; // dangling backslash — unterminated
      const single = SINGLE_CHAR_ESCAPES[next];
      if (single !== undefined) {
        value += single;
        i += 2;
        continue;
      }
      const octal = /^[0-7]{3}/.exec(text.slice(i + 1));
      if (octal !== null) {
        value += String.fromCodePoint(parseInt(octal[0], 8));
        i += 4;
        continue;
      }
      return null; // unsupported escape
    }
    value += ch;
    i += 1;
  }
  return null; // never closed
}

/** `"` + `\`-escape whatever the decoder above would need to reverse, then
 * `"` — always valid quoted syntax, whether or not the value actually
 * contains a space. Used to re-quote a remapped pattern that was quoted in
 * its v2 form, so the migrated rule round-trips through the same quoting
 * convention rather than landing unquoted (which would silently change its
 * meaning if the new path also needs quoting, e.g. still contains a space). */
function encodeCQuoted(value: string): string {
  let out = '"';
  for (const ch of value) {
    out += ch === "\\" || ch === '"' ? `\\${ch}` : ch;
  }
  return out + '"';
}

/**
 * Split a `.gitattributes` line into its leading PATTERN token and the
 * trailing attribute list — `config/connectors/x.json -diff` is the pattern
 * `config/connectors/x.json` plus attributes ` -diff`. Only the pattern
 * names a path; the attributes are opaque flags and must never be fed
 * through `mapV2Path` (finding 8, round 3 hardening: doing so on the WHOLE
 * line broke the mapping — a path string with a trailing ` -diff` matches
 * nothing, so a connector STATE-file rule landed remapped under `_config/`
 * instead of its real v3 home, `_bookkeeping/connectors/`). `.gitignore`
 * has no such second column — callers pass `hasAttributes: false` there and
 * get the whole line back as the pattern.
 *
 * A pattern token that starts with `"` is C-quoted (finding 5) — decoded via
 * {@link decodeCQuotedToken} rather than split on whitespace, so an embedded
 * space never gets mistaken for the pattern/attrs boundary. Throws
 * {@link OneRootPreflightError} naming the raw line when the quoting can't be
 * decoded, rather than silently mis-splitting it and stranding a stale rule.
 */
function splitAttributesLine(
  rule: string,
  { hasAttributes }: { hasAttributes: boolean },
): { pattern: string; attrs: string; quoted: boolean } {
  if (rule.startsWith('"')) {
    const decoded = decodeCQuotedToken(rule);
    if (decoded === null) {
      throw new OneRootPreflightError(
        "Cannot decode the quoted pattern on this .gitignore/.gitattributes line — refusing to migrate rather " +
          `than risk mis-splitting it and stranding a stale rule pointing at a path that's about to move: ${rule}`,
      );
    }
    return { pattern: decoded.value, attrs: hasAttributes ? rule.slice(decoded.endIndex) : "", quoted: true };
  }
  if (!hasAttributes) return { pattern: rule, attrs: "", quoted: false };
  const match = /^(\S+)(\s.*)?$/.exec(rule);
  if (match === null) return { pattern: rule, attrs: "", quoted: false };
  return { pattern: match[1] ?? rule, attrs: match[2] ?? "", quoted: false };
}

/**
 * Remap one ignore/attributes rule's PATH portion to its v3 equivalent via
 * `mapV2Path`, preserving a leading `!` (negation), a leading `/` (anchor),
 * a trailing `/` (directory marker), and — for `.gitattributes`
 * (`hasAttributes: true`) — the trailing attribute list untouched. A
 * quoted pattern (finding 5) is re-quoted on the way back out, so it stays
 * valid (and round-trips) whether or not the remapped path still needs
 * quoting.
 *
 * `stripPrefix`, when non-null, is required and stripped before mapping:
 * a PACKAGE-root rule (finding 8) is package-root-relative, so only a rule
 * naming something under `content/` (e.g. `content/docs/private.env`) is
 * migration-affected at all — anything else names a package-root path
 * unaffected by the migration and is returned UNCHANGED. A CONTENT-root
 * rule (`stripPrefix: null`) is already content-relative with nothing to
 * strip. Either way, a path `mapV2Path` can't resolve is carried forward
 * UNCHANGED rather than dropped — a dead rule that matches nothing is a far
 * smaller risk than silently losing coverage over a secret.
 */
function remapRule(rule: string, { hasAttributes, stripPrefix }: { hasAttributes: boolean; stripPrefix: string | null }): string {
  const { pattern, attrs, quoted } = splitAttributesLine(rule, { hasAttributes });
  let negated = false;
  let body = pattern;
  if (body.startsWith("!")) {
    negated = true;
    body = body.slice(1);
  }
  const anchored = body.startsWith("/");
  if (anchored) body = body.slice(1);
  const trailingSlash = body.endsWith("/");
  let corePath = trailingSlash ? body.slice(0, -1) : body;
  if (stripPrefix !== null) {
    if (!corePath.startsWith(stripPrefix)) return rule; // Package-root-relative, unaffected by the migration.
    corePath = corePath.slice(stripPrefix.length);
  }
  if (corePath === "") return rule;
  const mapped = mapV2Path(corePath);
  if (mapped.kind !== "move") return rule;
  const newPatternBody = `${negated ? "!" : ""}/${mapped.newPath}${trailingSlash ? "/" : ""}`;
  const newPattern = quoted ? encodeCQuoted(newPatternBody) : newPatternBody;
  return hasAttributes ? `${newPattern}${attrs}` : newPattern;
}

/** Exported for `box/index.ts`'s `initBox` (finding 4, round 3 hardening) —
 * a routine `bbx init` re-run must preserve whatever's under this marker
 * across its own wholesale `.gitignore`/`.gitattributes` regeneration, not
 * just the one regen this migration itself runs. One marker string, not two
 * hand-kept in sync. */
export const MIGRATED_SECTION_HEADER = "# Migrated local rules (from the v2 box's .gitignore/.gitattributes)";

/** Append whatever custom rule from the captured v2 files isn't already
 * covered by the freshly regenerated v3 file — call AFTER `initBox` has
 * written the v3 `.gitignore`/`.gitattributes`. */
export async function mergeIgnoreRules(params: { packageRoot: string; snapshot: IgnoreSnapshot }): Promise<void> {
  await mergeOneFile({
    filePath: path.join(params.packageRoot, ".gitignore"),
    hasAttributes: false,
    packageRules: params.snapshot.packageGitignoreRules,
    contentRules: params.snapshot.contentGitignoreRules,
  });
  await mergeOneFile({
    filePath: path.join(params.packageRoot, ".gitattributes"),
    hasAttributes: true,
    packageRules: params.snapshot.packageGitattributesRules,
    contentRules: params.snapshot.contentGitattributesRules,
  });
}

async function mergeOneFile(params: {
  filePath: string;
  hasAttributes: boolean;
  packageRules: string[];
  contentRules: string[];
}): Promise<void> {
  const current = (await readIfExists(params.filePath)) ?? "";
  // Finding 8: a PACKAGE-root rule is only migration-affected when it names
  // something under `content/` (e.g. `content/docs/private.env`) — anything
  // else is package-root-relative and untouched by the migration, so
  // `remapRule`'s `stripPrefix` requirement leaves it unchanged. A
  // CONTENT-root rule is already content-relative (`stripPrefix: null`).
  //
  // Finding 4 (round 4 hardening): this used to dedup `candidates` — against
  // the freshly regenerated `current` file's lines AND against each other —
  // before appending. Both git's `.gitattributes` attribute list and a
  // `.gitignore` negation are ORDER-DEPENDENT (the LAST matching rule wins),
  // so collapsing a repeated line down to its first occurrence can silently
  // flip the effective final rule: `X -diff` / `X diff` / `X -diff` dedupes
  // to `X -diff` / `X diff` (two rules instead of three), which now reads as
  // "diff" instead of the original "-diff". There is no dedup that preserves
  // both "no duplicate lines" AND "the last occurrence stays last" without
  // reasoning about every later rule's relationship to every earlier one, so
  // this doesn't try one: every migrated candidate is appended VERBATIM, in
  // its original relative order, duplicates included. A candidate that
  // happens to already be a line in the freshly regenerated `current` file
  // is harmless redundancy here (it still applies to the same path the same
  // way), not a correctness risk — matching `box/index.ts`'s own migrated-
  // section preservation, which is likewise a verbatim carry-forward, not a
  // deduped one.
  const additions = [
    ...params.packageRules.map((rule) => remapRule(rule, { hasAttributes: params.hasAttributes, stripPrefix: "content/" })),
    ...params.contentRules.map((rule) => remapRule(rule, { hasAttributes: params.hasAttributes, stripPrefix: null })),
  ];
  if (additions.length === 0) return;
  const merged = `${current.trimEnd()}\n\n${MIGRATED_SECTION_HEADER}\n${additions.join("\n")}\n`;
  await fs.writeFile(params.filePath, merged);
}

export interface BoxWideIgnoredEntry {
  /** The pre-migration ignored FILE path, box-root-relative (POSIX-separated). */
  oldRelPath: string;
  /** Where that file is expected to be ignored post-migration, box-root-relative. */
  expectedNewRelPath: string;
}

/** Everything a v2 box's `content/` prefix maps to under v3, plus `.beebox`
 * (moved by `moveBeebox`, not `mapV2Path` — it's excluded from the migration
 * walk entirely). Returns `null` for a content-relative path `mapV2Path`
 * classifies as `discard`/`merge-claude-md`/`unmapped` — none of those has a
 * v3 location to verify (a `discard`ed `content/.gitignore` is SUPPOSED to
 * stop being ignored-at-that-path; it doesn't exist there any more). */
function expectedNewRelPath(oldRelPath: string): string | null {
  if (!oldRelPath.startsWith("content/")) return oldRelPath; // Package-root-relative — unchanged in v3.
  const contentRel = oldRelPath.slice("content/".length);
  if (contentRel.startsWith(".beebox/")) return contentRel;
  const mapped = mapV2Path(contentRel);
  return mapped.kind === "move" ? mapped.newPath : null;
}

/** A top-level v2-package area whose entire subtree stays at the SAME path
 * under v3 (unaffected by the migration) and can hold thousands of ignored
 * entries (an installed `node_modules/`) — excluded from the box-wide
 * inventory below purely so a real, npm-installed box doesn't pay to
 * enumerate every ignored file inside it one by one. Its own top-level
 * ignore rule (`node_modules/`) is still carried forward by
 * {@link mergeIgnoreRules} like any other rule; this exclusion only concerns
 * the PER-FILE regression inventory. */
function isExcludedBulkPath(relPath: string): boolean {
  return relPath === "node_modules" || relPath.startsWith("node_modules/") || relPath.includes("/node_modules/");
}

/** Inventory every INDIVIDUAL ignored file across the WHOLE box (package
 * root + `content/`) at preflight — not just the entries this migration's
 * own move-plan records as untracked renames. Deliberately file-level
 * (`git ls-files --others --ignored`), not `git status --ignored` (which
 * COLLAPSES a directory whose entire content happens to be ignored into
 * reporting the directory itself — e.g. a package-root `src/` that, in a
 * fresh box, holds nothing but one ignored file collapses to `src/`, and
 * `src` itself matches no real ignore rule, which would falsely read as a
 * regression). Call before anything moves. */
export async function snapshotBoxWideIgnored(params: { packageRoot: string }): Promise<BoxWideIgnoredEntry[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
    cwd: params.packageRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries: BoxWideIgnoredEntry[] = [];
  for (const oldRelPath of stdout.split("\0")) {
    if (oldRelPath === "" || isExcludedBulkPath(oldRelPath)) continue;
    const expected = expectedNewRelPath(oldRelPath);
    if (expected === null) continue;
    entries.push({ oldRelPath, expectedNewRelPath: expected });
  }
  return entries;
}

/** The box-wide counterpart of `one-root-move-plan.ts`'s
 * `verifyNoIgnoreRegression` — same fail-closed `isGitIgnored` probe, applied
 * to every path {@link snapshotBoxWideIgnored} recorded rather than only the
 * ones this run's move-plan itself renamed. Call AFTER `initBox` (and the
 * `.gitignore`/`.gitattributes` merge) has written the final v3 files. */
export async function verifyNoBoxWideIgnoreRegression(params: {
  packageRoot: string;
  before: BoxWideIgnoredEntry[];
}): Promise<void> {
  const regressed: string[] = [];
  for (const entry of params.before) {
    const newAbs = path.join(params.packageRoot, entry.expectedNewRelPath);
    if (!(await isGitIgnored(params.packageRoot, newAbs))) regressed.push(entry.expectedNewRelPath);
  }
  if (regressed.length > 0) throw new OneRootGitignoreRegressionError(regressed);
}
