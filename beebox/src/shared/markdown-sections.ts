/**
 * Markdown section splitting for long card bodies.
 *
 * A body over the split threshold becomes one search document per heading
 * section (text under that heading, until the next heading of any level),
 * with a hierarchical section path like `/Components/Programs`. Text before
 * the first heading is the preamble and stays with the card's own document.
 * Every section path is unique: a repeated path gets `~N` (`/Notes`,
 * `/Notes~2`), skipping any number a literal heading already took
 * (`uniqueSectionPaths`). Search document ids and the view's lookup both rely
 * on that uniqueness, so this is the only place sections are numbered.
 *
 * Shared because the search indexer and the web view must agree on section
 * paths: a search result names its section by path, and the view finds that
 * section in the body it rendered (`sectionLines`, matched to the rendered
 * headings' `data-line`).
 *
 * Adapted from ske's `extractMarkdownSections` (predecessor project).
 */

import { invariant } from "./invariant.js";

export interface MarkdownSection {
  /** Hierarchical heading path, e.g. "/Components/Programs" (`~N` on repeats). */
  fragment: string;
  /** 0-based line of the section's heading in the source text. */
  line: number;
  text: string;
}

export interface SplitBody {
  /** Text before the first heading (may be empty). */
  preamble: string;
  sections: MarkdownSection[];
}

interface HeadingFrame {
  level: number;
  title: string;
}

/**
 * Split a markdown body into its heading sections. Bodies with no headings
 * come back as a bare preamble and no sections. A section with no text is
 * not emitted, and does not count toward `~N`.
 */
export function splitMarkdownSections(bodyText: string): SplitBody {
  const lines = bodyText.split("\n");
  const sections: Omit<MarkdownSection, "fragment">[] = [];
  const paths: string[] = [];
  const stack: HeadingFrame[] = [];
  let currentText: string[] = [];
  let headingLine = -1;
  let preamble = "";

  const flush = (): void => {
    const text = currentText.join("\n").trim();
    currentText = [];
    if (headingLine === -1) {
      preamble = text;
      return;
    }
    if (text === "") return;
    paths.push("/" + stack.map((h) => h.title).join("/"));
    sections.push({ line: headingLine, text });
  };

  for (const [index, line] of lines.entries()) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading === null) {
      currentText.push(line);
      continue;
    }
    flush();
    headingLine = index;
    invariant(
      heading[1] !== undefined && heading[2] !== undefined,
      "both capture groups always participate when the heading regex matches"
    );
    const level = heading[1].length;
    const title = heading[2].trim();
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      invariant(top !== undefined, "stack.length > 0 guarantees a last element");
      if (top.level < level) break;
      stack.pop();
    }
    stack.push({ level, title });
  }
  flush();

  const unique = uniqueSectionPaths(paths);
  return {
    preamble,
    sections: sections.map((section, index) => {
      const fragment = unique[index];
      invariant(fragment !== undefined, "uniqueSectionPaths returns one path per input");
      return { fragment, ...section };
    }),
  };
}

/**
 * Number repeated paths so no two are equal. The Nth occurrence of a path
 * gets `~N`; if that is already taken (a literal `## Notes~2` heading), the
 * next free number is used, and a later literal that collides with an earlier
 * assignment is numbered in turn (`/Notes~2~2`).
 */
export function uniqueSectionPaths(paths: readonly string[]): string[] {
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  return paths.map((path) => {
    let n = (counts.get(path) ?? 0) + 1;
    counts.set(path, n);
    let candidate = n === 1 ? path : `${path}~${String(n)}`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${path}~${String(n)}`;
    }
    taken.add(candidate);
    return candidate;
  });
}

/** Each section path in `source`, mapped to its heading's 0-based line. */
export function sectionLines(source: string): Map<string, number> {
  return new Map(splitMarkdownSections(source).sections.map((s) => [s.fragment, s.line]));
}
