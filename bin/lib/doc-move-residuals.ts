/**
 * The last pass of a document move (`bin/lib/doc-move.ts`): path tokens the
 * link and backticked-path scanners do not parse — a link label, a prose
 * path, an HTML href — that still name the moved file.
 */

import * as path from "node:path";
import { BOX_FACING_PREFIXES } from "../../beebox/src/dev/doc-check/file-paths.js";
import type { DocMoveNotice, DocMoveRewrite } from "./doc-move.js";

export function ambiguousMessage(token: string, candidates: readonly string[]): string {
  return `ambiguous path \`${token}\` (matches ${candidates.join(", ")}); not rewritten`;
}

const PATH_CHAR = /[\w./~-]/;
// A character after the basename that makes the token a different path
// (`a.md.bak`, `a.mdx`, `a.md/x`, `a.md-old`). A `#anchor`, `:L3`, or
// sentence punctuation ends it.
const PATH_CONTINUES = /^(?:[\w/-]|\.\w)/;

interface PathToken { start: number; end: number; text: string }

// Each complete path-like token in `line` that ends with `basename`.
function tokensEndingWith(line: string, basename: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (let at = line.indexOf(basename); at !== -1; at = line.indexOf(basename, at + basename.length)) {
    const end = at + basename.length;
    if (PATH_CONTINUES.test(line.slice(end, end + 2))) continue;
    let start = at;
    while (start > 0 && PATH_CHAR.test(line[start - 1] ?? "")) start--;
    tokens.push({ start, end, text: line.slice(start, end) });
  }
  return tokens;
}

// Half-open ranges of inline-link labels: the text of `[label](`.
function inlineLabelRanges(line: string): Array<[number, number]> {
  return [...line.matchAll(/\[([^\]]*)]\(/g)].map((m) => [m.index + 1, m.index + 1 + (m[1] ?? "").length]);
}

// Path tokens left in a maintained file that name `from`: a token ending in
// its basename that resolves to it from the file's directory, its package
// root, beebox/, or the repo root (a bare basename is a name, not a path).
// When `from` is the only existing file the token could name, it is
// rewritten to name `to` from the same base; otherwise it blocks the move.
// With `linkFormsOnly` (a historical record), only inline-link labels and
// HTML `href`s are read; a reference definition's target was already
// rewritten and its identifier is never touched.
export function residuals({ rel, content, from, to, exists, linkFormsOnly, rewrites, notices }: {
  rel: string; content: string; from: string; to: string; exists: (rel: string) => boolean;
  linkFormsOnly: boolean; rewrites: DocMoveRewrite[]; notices: DocMoveNotice[];
}): string {
  // Paths in box-facing docs name files in a box, not in this repository.
  if (BOX_FACING_PREFIXES.some((p) => rel.startsWith(p))) return content;
  const basename = path.posix.basename(from);
  const bases = [...new Set([path.posix.dirname(rel), rel.split("/")[0] ?? ".", "beebox", "."])];
  return content.split("\n").map((line, i) => {
    if (!line.includes(basename)) return line;
    const labels = inlineLabelRanges(line);
    const inLabel = (t: PathToken): boolean => labels.some(([s, e]) => t.start >= s && t.end <= e);
    let out = line;
    const found: DocMoveRewrite[] = [];
    // Right to left, so earlier offsets stay valid as tokens change length.
    for (const token of tokensEndingWith(line, basename).toReversed()) {
      if (!token.text.includes("/")) continue;
      const label = inLabel(token);
      if (linkFormsOnly && !label && !line.slice(0, token.start).endsWith('href="')) continue;
      const absolute = token.text.startsWith("/");
      const resolve = (base: string): string => path.posix.normalize(absolute ? token.text.slice(1) : path.posix.join(base, token.text));
      const tokenBases = absolute ? ["."] : bases;
      const base = tokenBases.find((b) => resolve(b) === from);
      if (base === undefined) continue;
      const named = [...new Set(tokenBases.map(resolve))].filter((r) => r === from || exists(r));
      if (named.length > 1) {
        notices.push({ path: rel, line: i + 1, message: ambiguousMessage(token.text, named), blocking: true });
        continue;
      }
      const replacement = absolute ? `/${to}` : path.posix.relative(base, to);
      out = out.slice(0, token.start) + replacement + out.slice(token.end);
      found.push({ line: i + 1, from: token.text, to: replacement, kind: label ? "label" : "prose" });
    }
    rewrites.push(...found.toReversed());
    return out;
  }).join("\n");
}
