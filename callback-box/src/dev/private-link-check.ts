/**
 * Lexical guard: tracked (public) files must never link into `private-issues/`
 * — a gitignored symlink some developers mount at the monorepo root, pointing
 * at a separate private repo. A link into it resolves fine on an opted-in
 * machine (the symlink exists) but is dangling for everyone else, so a
 * filesystem-resolution check (like the rest of doc-check) would silently
 * pass it there. This check is lexical and runs before/independent of any
 * filesystem resolution — see docs/implemented-plans/private-issues-shadow-repo.md
 * section I.
 *
 * Pure logic (no fs) so it's unit-testable; `doc-check.ts` wires it to the
 * real tree.
 */

import * as path from "node:path";

export const PRIVATE_LINK_REASON =
  "public files must not link into private-issues/ — it is a separate private repo; " +
  "move the link into a private issue instead (private→public links are allowed)";

export interface PrivateLinkViolation {
  path: string;
  line: number;
  target: string;
}

function hasUriScheme(target: string): boolean {
  return /^[a-z][\d+.a-z-]*:/i.test(target);
}

function stripFragmentAndQuery(target: string): string {
  return target.replace(/[#?].*$/, "").trim();
}

// CommonMark allows wrapping a link destination in angle brackets
// (`[x](<private-issues/a.md>)`), including a trailing title outside them
// (`<...> "title"`). Unwrap before any other parsing.
function unwrapAngleBrackets(target: string): string {
  const trimmed = target.trim();
  if (!trimmed.startsWith("<")) return trimmed;
  const closeIdx = trimmed.indexOf(">");
  return closeIdx === -1 ? trimmed : trimmed.slice(1, closeIdx);
}

// Absolute (scheme://host/path) targets check only their path portion; a
// non-URL scheme (mailto:, tel:, ...) has no filesystem/route path to check.
function pathnameOf(target: string): { pathname: string; isExternal: boolean } | undefined {
  const cleaned = stripFragmentAndQuery(unwrapAngleBrackets(target));
  if (!cleaned) return undefined;
  if (!hasUriScheme(cleaned)) return { pathname: cleaned, isExternal: false };
  try {
    return { pathname: new URL(cleaned).pathname, isExternal: true };
  } catch (_e) {
    return undefined;
  }
}

function hasConsecutiveSegments(segments: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= segments.length; i++) {
    if (needle.every((seg, j) => segments[i + j] === seg)) return true;
  }
  return false;
}

// Forbidden if the (posix-normalized) path segments contain a `private-issues`
// segment exactly (relative, `../`-relative, or root-relative forms), or if
// any target at all — including an external URL to another host — has a
// literal `/dev/issues/private/` segment run (the private issues browser
// route). Segment-exact: "not-private-issues-thing.md" never matches.
export function isForbiddenPrivateLinkTarget(rawTarget: string): boolean {
  const resolved = pathnameOf(rawTarget);
  if (!resolved) return false;

  const segments = path.posix
    .normalize(resolved.pathname)
    .split("/")
    .filter((s) => s.length > 0 && s !== ".");

  if (hasConsecutiveSegments(segments, ["dev", "issues", "private"])) return true;
  if (resolved.isExternal) return false;
  return segments.includes("private-issues");
}

// Half-open [start, end) ranges of inline-code spans on a line, so link
// syntax quoted inside backticks (illustrating syntax in prose/docs) is
// never treated as a live link. Mirrors doc-link-repair.ts.
function inlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of line.matchAll(/(`+)(?:(?!\1).)*\1/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

const INLINE_LINK_RE = /\[([^\]]*)]\(([^)]+)\)/g;
// Reference-style definition: `[label]: target` or `[label]: <target>`,
// optionally indented up to 3 spaces (CommonMark's definition-list allowance).
const REF_DEF_RE = /^ {0,3}\[[^\]]+]:\s*(?:<([^>]*)>|(\S+))/;

// Scan one file's raw content for forbidden private-issues link targets,
// across inline links, reference-style definitions, and dev-browser URLs.
// Fenced code blocks and inline code spans are skipped (they illustrate
// syntax, not real references); prose mentions of the phrase are never
// matched — only link targets are.
export function findPrivateLinkViolations(filePath: string, content: string): PrivateLinkViolation[] {
  const violations: PrivateLinkViolation[] = [];
  let inFence = false;

  for (const [i, line] of content.split("\n").entries()) {
    const lineNum = i + 1;
    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const codeRanges = inlineCodeRanges(line);
    const inCode = (offset: number): boolean => codeRanges.some(([s, e]) => offset >= s && offset < e);

    for (const match of line.matchAll(INLINE_LINK_RE)) {
      const target = match[2];
      if (target === undefined || inCode(match.index)) continue;
      if (isForbiddenPrivateLinkTarget(target)) violations.push({ path: filePath, line: lineNum, target });
    }

    const refMatch = REF_DEF_RE.exec(line);
    if (refMatch) {
      const target = refMatch[1] ?? refMatch[2];
      if (target !== undefined && isForbiddenPrivateLinkTarget(target)) {
        violations.push({ path: filePath, line: lineNum, target });
      }
    }
  }

  return violations;
}
