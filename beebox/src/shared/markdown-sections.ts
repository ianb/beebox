/**
 * Markdown section splitting for long card bodies.
 *
 * A body over the split threshold becomes one search document per heading
 * section (text under that heading, until the next heading of any level),
 * with a hierarchical section path like `/Components/Programs`. Text before
 * the first heading is the preamble and stays with the card's own document.
 * A repeated path gets `~N` for its Nth occurrence (`/Notes`, `/Notes~2`).
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
  const sections: MarkdownSection[] = [];
  const seen = new Map<string, number>();
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
    const path = "/" + stack.map((h) => h.title).join("/");
    const n = (seen.get(path) ?? 0) + 1;
    seen.set(path, n);
    sections.push({ fragment: n === 1 ? path : `${path}~${String(n)}`, line: headingLine, text });
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

  return { preamble, sections };
}

/** Each section path in `source`, mapped to its heading's 0-based line. */
export function sectionLines(source: string): Map<string, number> {
  return new Map(splitMarkdownSections(source).sections.map((s) => [s.fragment, s.line]));
}
