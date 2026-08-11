/**
 * Basename-based markdown-link repair — the fixable half of the doc-link decay
 * problem. When a doc moves (e.g. an issue resolves: `bugs/foo.md` →
 * `closed/bugs/foo.md`), every relative link to it breaks. Where a target's
 * basename is unique repo-wide, the current location is recoverable, so a
 * broken link can be rewritten to point at wherever the file lives now.
 *
 * Pure logic lives here (fs/git injected as callbacks) so it's unit-testable;
 * `doc-check.ts --fix` wires it to the real tree.
 */

import * as path from "node:path";

// Basenames that are intentionally non-unique — one per directory — so they're
// exempt from the uniqueness invariant AND excluded as basename-repair
// resolution candidates (we can't know which directory's copy a broken link
// meant). Extensible: add more one-per-dir conventional filenames here.
export const NON_UNIQUE_BASENAMES = new Set(["CLAUDE.md", "README.md", "SKILL.md"]);

// A repair can't be made for one of three reasons. `no-basename-match` is a
// true rename/delete (manual work); `ambiguous-basename` means 2+ files share
// the basename (can't guess); `non-unique-basename` is a whitelisted
// one-per-dir name we deliberately never auto-resolve.
export type UnfixableReason = "no-basename-match" | "ambiguous-basename" | "non-unique-basename";

export interface LinkRewrite {
  line: number;
  from: string; // original link target (path plus any #anchor)
  to: string; // rewritten link target
}

export interface UnfixableLink {
  line: number;
  target: string; // original link target
  reason: UnfixableReason;
}

export interface RepairResult {
  content: string; // input content with fixable links rewritten
  rewrites: LinkRewrite[];
  unfixable: UnfixableLink[];
}

// Standard markdown inline link: [text](target). Titles (`(x.md "t")`) end up
// in the target group and get filtered out by the .md-suffix check.
const LINK_RE = /\[([^\]]*)]\(([^)]+)\)/g;

function hasUriScheme(ref: string): boolean {
  return /^[a-z][\d+.a-z-]*:/i.test(ref);
}

function splitAnchor(target: string): { pathPart: string; anchor: string } {
  const hashIdx = target.indexOf("#");
  if (hashIdx === -1) return { pathPart: target, anchor: "" };
  return { pathPart: target.slice(0, hashIdx), anchor: target.slice(hashIdx) };
}

// Group `files` by basename, returning only the basenames with 2+ members
// (the duplicates). Whitelisted one-per-dir basenames are never counted.
export function duplicateBasenames(files: string[]): Map<string, string[]> {
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    const base = path.posix.basename(f);
    if (NON_UNIQUE_BASENAMES.has(base)) continue;
    const list = byBase.get(base);
    if (list) list.push(f);
    else byBase.set(base, [f]);
  }
  const dups = new Map<string, string[]>();
  for (const [base, list] of byBase) if (list.length >= 2) dups.set(base, list.toSorted());
  return dups;
}

// basename -> [repo-relative paths], excluding whitelisted names. Used to
// resolve a broken link's basename to its current location.
export function buildBasenameLookup(files: string[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const f of files) {
    const base = path.posix.basename(f);
    if (NON_UNIQUE_BASENAMES.has(base)) continue;
    const list = lookup.get(base);
    if (list) list.push(f);
    else lookup.set(base, [f]);
  }
  return lookup;
}

type LinkDecision =
  | { kind: "leave" }
  | { kind: "rewrite"; to: string }
  | { kind: "unfixable"; reason: UnfixableReason };

// Decide the fate of one link target, given the source file's directory and
// the lookup context. `leave` covers non-file, external, absolute, anchor-only,
// repo-escaping, and already-resolving targets.
function decideLink(
  target: string,
  ctx: { fromDir: string; fileExists: (repoRelPath: string) => boolean; basenameLookup: Map<string, string[]> },
): LinkDecision {
  const { pathPart, anchor } = splitAnchor(target);
  if (!pathPart || pathPart.startsWith("#") || pathPart.startsWith("/") || hasUriScheme(pathPart)) return { kind: "leave" };
  if (!pathPart.endsWith(".md")) return { kind: "leave" };

  const intended = path.posix.normalize(path.posix.join(ctx.fromDir, pathPart));
  if (intended.startsWith("..")) return { kind: "leave" }; // escapes the repo — not ours to fix
  if (ctx.fileExists(intended)) return { kind: "leave" }; // link already resolves

  const base = path.posix.basename(pathPart);
  if (NON_UNIQUE_BASENAMES.has(base)) return { kind: "unfixable", reason: "non-unique-basename" };
  const candidates = ctx.basenameLookup.get(base);
  if (!candidates || candidates.length === 0) return { kind: "unfixable", reason: "no-basename-match" };
  if (candidates.length >= 2) return { kind: "unfixable", reason: "ambiguous-basename" };

  const newPath = candidates[0];
  if (newPath === undefined) return { kind: "leave" };
  const newTarget = `${path.posix.relative(ctx.fromDir, newPath)}${anchor}`;
  return newTarget === target ? { kind: "leave" } : { kind: "rewrite", to: newTarget };
}

// Half-open [start, end) ranges of inline-code spans on a single line, so link
// syntax quoted inside backticks (`[x](y)` in prose/CLAUDE.md examples) is
// never rewritten — it illustrates syntax, it isn't a live link.
function inlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of line.matchAll(/(`+)(?:(?!\1).)*\1/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

// Repair broken relative .md links in one file's content. `fromRel` is the
// file's repo-relative POSIX path; `fileExists` tests a repo-relative path;
// `basenameLookup` maps a basename to the repo-relative files carrying it.
// A link is only touched when its literal relative target does NOT resolve on
// disk. Links that resolve, external/absolute/anchor-only links, links
// escaping the repo, and links inside inline-code spans or fenced code blocks
// are all left untouched.
export function repairLinks({
  fromRel,
  content,
  fileExists,
  basenameLookup,
}: {
  fromRel: string;
  content: string;
  fileExists: (repoRelPath: string) => boolean;
  basenameLookup: Map<string, string[]>;
}): RepairResult {
  const rewrites: LinkRewrite[] = [];
  const unfixable: UnfixableLink[] = [];
  const ctx = { fromDir: path.posix.dirname(fromRel), fileExists, basenameLookup };

  let inFence = false;
  const outLines = content.split("\n").map((line, i) => {
    const lineNum = i + 1;
    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence; // a fence delimiter toggles the code block; leave the line as-is
      return line;
    }
    if (inFence) return line;

    const codeRanges = inlineCodeRanges(line);
    const inCode = (offset: number): boolean => codeRanges.some(([s, e]) => offset >= s && offset < e);

    let out = "";
    let cursor = 0;
    for (const match of line.matchAll(LINK_RE)) {
      const full = match[0];
      const target = match[2] ?? "";
      const offset = match.index;
      let replacement = full;
      if (!inCode(offset)) {
        const decision = decideLink(target, ctx);
        if (decision.kind === "unfixable") {
          unfixable.push({ line: lineNum, target, reason: decision.reason });
        } else if (decision.kind === "rewrite") {
          rewrites.push({ line: lineNum, from: target, to: decision.to });
          replacement = `[${match[1] ?? ""}](${decision.to})`;
        }
      }
      out += line.slice(cursor, offset) + replacement;
      cursor = offset + full.length;
    }
    return out + line.slice(cursor);
  });

  return { content: outLines.join("\n"), rewrites, unfixable };
}

// Repair the path-bearing plan/issue frontmatter fields without reserializing
// YAML (which would churn unrelated formatting and comments). The schema keeps
// these paths as plain scalar values or an `issues:` block list.
export function repairFrontmatterPaths({
  fromRel,
  content,
  fileExists,
  basenameLookup,
}: {
  fromRel: string;
  content: string;
  fileExists: (repoRelPath: string) => boolean;
  basenameLookup: Map<string, string[]>;
}): RepairResult {
  if (!content.startsWith("---\n")) return { content, rewrites: [], unfixable: [] };
  const rewrites: LinkRewrite[] = [];
  const unfixable: UnfixableLink[] = [];
  const ctx = { fromDir: path.posix.dirname(fromRel), fileExists, basenameLookup };
  let inFrontmatter = true;
  let issuesList = false;
  const lines = content.split("\n").map((line, index) => {
    if (!inFrontmatter) return line;
    if (index > 0 && line === "---") {
      inFrontmatter = false;
      return line;
    }
    if (index === 0) return line;
    const scalar = /^(design|superseded-by):(\s*)(\S+\.md)$/.exec(line);
    if (/^issues:\s*$/.test(line)) issuesList = true;
    else if (/^\S/.test(line)) issuesList = false;
    const listItem = issuesList ? /^(\s+-\s+)(\S+\.md)$/.exec(line) : null;
    const target = scalar?.[3] ?? listItem?.[2];
    if (!target) return line;
    const decision = decideLink(target, ctx);
    if (decision.kind === "unfixable") {
      unfixable.push({ line: index + 1, target, reason: decision.reason });
      return line;
    }
    if (decision.kind !== "rewrite") return line;
    rewrites.push({ line: index + 1, from: target, to: decision.to });
    return scalar ? `${scalar[1]}:${scalar[2]}${decision.to}` : `${listItem?.[1] ?? ""}${decision.to}`;
  });
  return { content: lines.join("\n"), rewrites, unfixable };
}
