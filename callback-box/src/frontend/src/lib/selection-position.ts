/**
 * Position locator for a text selection inside a rendered document.
 *
 * A selection's `position` is a single freeform string the agent reads as a
 * *rough* hint (not an exact offset) for finding the original text in the
 * source: which section (frontmatter vs body), the nearest heading above it
 * (with its `#id` anchor), the paragraph number, and an approximate source
 * line. Nothing parses it rigidly, so its shape can evolve without a
 * vocabulary migration.
 *
 * Split in two: `formatPosition` is pure (string in, string out — unit
 * tested) and `extractSelection` walks the live DOM (verified in the
 * browser, since the tree-walk depends on the real rendered document).
 * `extractSelection` depends only on the DOM tree + attributes, never on
 * geometry, so the geometry-only concern (placing the "+") stays isolated in
 * the capture component.
 */

export interface SelectionParts {
  /** "frontmatter" | "body" | "mixed", or null when undeterminable. */
  section: string | null;
  /** Nearest heading above the selection, with its slug id, or null. */
  heading: { text: string; id: string } | null;
  /** 1-based paragraph number after the nearest heading, or null. */
  paragraph: number | null;
  /** Approximate source line (from the nearest `data-line`), or null. */
  line: number | null;
}

export interface ExtractedSelection {
  text: string;
  position: string;
}

/** A captured selection ready to attach to a message: source ref + the extracted pieces. */
export interface AddSelectionInput {
  /** Box-relative path of the source document, absolute (leading "/"). */
  ref: string;
  text: string;
  position: string;
}

/**
 * Render `SelectionParts` into the freeform `position` string. Clauses are
 * omitted when their part is null, joined with "; ". All-null yields "".
 */
export function formatPosition(parts: SelectionParts): string {
  const clauses: string[] = [];
  if (parts.section !== null) {
    clauses.push(parts.section);
  }
  if (parts.heading !== null) {
    clauses.push(`heading: ${parts.heading.text} (#${parts.heading.id})`);
  }
  if (parts.paragraph !== null) {
    clauses.push(`paragraph ${parts.paragraph}`);
  }
  if (parts.line !== null) {
    clauses.push(`~line ${parts.line}`);
  }
  return clauses.join("; ");
}

function nodeToElement(node: Node): Element | null {
  if (node instanceof Element) {
    return node;
  }
  return node.parentElement;
}

/** True when `node` comes after `ref` in document order, or is inside it. */
function nodeFollows(ref: Element, node: Node): boolean {
  if (ref.contains(node)) {
    return true;
  }
  const rel = ref.compareDocumentPosition(node);
  return (rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * Compute `{ text, position }` for the current `selection` within
 * `container` (the rendered-document root). Returns null for an empty /
 * whitespace-only selection so the caller can suppress the "+".
 */
export function extractSelection(selection: Selection, container: Element): ExtractedSelection | null {
  const text = selection.toString().trim();
  if (text === "" || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const anchorNode = range.startContainer;
  const anchorEl = nodeToElement(anchorNode);

  let section: string | null = null;
  if (anchorEl !== null) {
    const sectionEl = anchorEl.closest("[data-card-section]");
    if (sectionEl !== null) {
      section = sectionEl.getAttribute("data-card-section");
    }
  }

  let heading: { text: string; id: string } | null = null;
  let line: number | null = null;
  let nearestHeading: Element | null = null;
  const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
  for (const h of headings) {
    if (nodeFollows(h, anchorNode)) {
      nearestHeading = h;
    }
  }
  if (nearestHeading !== null) {
    const id = nearestHeading.getAttribute("id");
    const headingText = nearestHeading.textContent;
    heading = { text: headingText === null ? "" : headingText.trim(), id: id === null ? "" : id };
    const dataLine = nearestHeading.getAttribute("data-line");
    if (dataLine !== null) {
      const parsed = parseInt(dataLine, 10);
      line = Number.isNaN(parsed) ? null : parsed;
    }
  }

  let paragraph: number | null = null;
  const paras = container.querySelectorAll("p");
  let count = 0;
  for (const p of paras) {
    if (nearestHeading !== null && !nodeFollows(nearestHeading, p)) {
      continue;
    }
    count += 1;
    if (p.contains(anchorNode)) {
      paragraph = count;
      break;
    }
  }

  return { text, position: formatPosition({ section, heading, paragraph, line }) };
}
