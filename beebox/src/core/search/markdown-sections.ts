/**
 * Markdown section splitting for long card bodies.
 *
 * A body over the split threshold becomes one search document per heading
 * section (text under that heading, until the next heading of any level),
 * with a hierarchical fragment path like `/Components/Programs`. Text before
 * the first heading is the preamble and stays with the card's own document.
 *
 * Adapted from ske's `extractMarkdownSections` (predecessor project).
 */

import { invariant } from "../../lib/invariant.js";

export interface MarkdownSection {
  /** Hierarchical heading path, e.g. "/Components/Programs". */
  fragment: string;
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
 * come back as a bare preamble and no sections.
 */
export function splitMarkdownSections(bodyText: string): SplitBody {
  const lines = bodyText.split("\n");
  const sections: MarkdownSection[] = [];
  const stack: HeadingFrame[] = [];
  let currentText: string[] = [];
  let sawHeading = false;
  let preamble = "";

  const flush = (): void => {
    const text = currentText.join("\n").trim();
    currentText = [];
    if (!sawHeading) {
      preamble = text;
      return;
    }
    if (text === "") return;
    const fragment = "/" + stack.map((h) => h.title).join("/");
    sections.push({ fragment, text });
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading === null) {
      currentText.push(line);
      continue;
    }
    flush();
    sawHeading = true;
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
