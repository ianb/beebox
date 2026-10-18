/**
 * Resolve a `ViewTarget.fragment` against a rendered file view.
 *
 * A fragment has two forms, told apart by the first character:
 *  - a section path (`/Plan/Status`, `/Notes~2`) — what search puts in a
 *    target, and what `bbx search` prints after `#`. It is looked up in the
 *    file's source text with the indexer's own splitter
 *    (`shared/markdown-sections.ts`), and the line found is matched to the
 *    rendered headings' `data-line` (`makeHeadingNode`). Matching by line, not
 *    by heading text or slug, keeps repeated headings, headings with markup,
 *    and a title heading that `CardBody` blanks all correct.
 *  - an element id (anything else) — what a markdown link like
 *    `Card.card#where-things-stand` names; heading ids never start with `/`.
 *
 * Works for any view that renders the indexed text (the card body, or a
 * markdown file's content) through the shared Markdown renderer, because
 * that renderer writes `data-line` on every heading.
 *
 * Only elements owned by `root` count: an element inside a nested
 * `[data-fragment-root]` (an embedded card) belongs to that embed.
 */

import { sectionLines } from "@shared/markdown-sections";

export const FRAGMENT_ROOT_ATTRIBUTE = "data-fragment-root";

export type FragmentResolution =
  | { kind: "element"; element: Element }
  /** The place is the start of the body. */
  | { kind: "top" }
  /** Nothing to match yet: the source or the headings have not rendered. */
  | { kind: "pending" }
  /** The section path is not in the current source. */
  | { kind: "missing" };

const HEADINGS = "h1[data-line], h2[data-line], h3[data-line], h4[data-line], h5[data-line], h6[data-line]";

function owned(root: Element, element: Element): boolean {
  return element.closest(`[${FRAGMENT_ROOT_ATTRIBUTE}]`) === root;
}

/**
 * `source` is the text the view renders and search indexed (`FileData.body`,
 * else `FileData.content`), or null before it loads. An id that is not found
 * yet is `pending`: the caller decides when to stop waiting.
 */
export function resolveFragment(root: Element, { fragment, source, atDeadline }: {
  fragment: string;
  source: string | null;
  /** The caller's last try: an undrawn title heading then resolves to the top. */
  atDeadline: boolean;
}): FragmentResolution {
  if (!fragment.startsWith("/")) {
    const element = [...root.querySelectorAll("[id]")].find((el) => el.id === fragment && owned(root, el));
    return element === undefined ? { kind: "pending" } : { kind: "element", element };
  }
  if (source === null) return { kind: "pending" };
  const lines = sectionLines(source);
  const line = lines.get(fragment);
  if (line === undefined) return { kind: "missing" };
  const headings = [...root.querySelectorAll(HEADINGS)].filter((el) => owned(root, el));
  // `data-line` is 1-based. The section's own heading, when it rendered.
  const exact = headings.find((el) => Number(el.getAttribute("data-line")) === line + 1);
  if (exact !== undefined) return { kind: "element", element: exact };
  // A section whose heading opens the source and did not render is a title
  // heading that `CardBody` blanked (it repeats the card's title): its place
  // is the top. With no headings drawn at all, the body may not be drawn yet,
  // so wait until the deadline.
  if (source.split("\n").slice(0, line).every((text) => text.trim() === "")) {
    return headings.length > 0 || atDeadline ? { kind: "top" } : { kind: "pending" };
  }
  if (headings.length === 0) return { kind: "pending" };
  // No heading at the section's line: a `#` line inside a code fence, which
  // the splitter counts and the renderer does not. The last heading above it
  // is the heading of the section that contains it.
  let best: Element | null = null;
  for (const heading of headings) {
    if (Number(heading.getAttribute("data-line")) <= line + 1) best = heading;
  }
  return best === null ? { kind: "top" } : { kind: "element", element: best };
}
