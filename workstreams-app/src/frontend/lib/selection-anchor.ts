// Turning a selection into something a comment can carry, and finding it again
// (`docs/plans/document-comments.md`, Track 3).
//
// TWO HALVES OF ONE ALREADY-INSTALLED LIBRARY. `generateFragment` is Chrome's
// own "Copy link to highlight" implementation: it walks the selection and
// returns the minimal words that uniquely identify it. `processTextFragmentDirective`
// is the matching side, already used in beebox
// (`src/frontend/src/lib/selection/quote-anchor.ts`). Using both means not
// hand-rolling a prefix/suffix heuristic that a browser vendor has already
// tuned.
//
// THE ANCHOR IS NOT LOAD-BEARING. `quoted` — the selected text, verbatim — is
// the payload, because the reader that matters is an agent running `cat` on a
// YAML file. The fragment only buys in-page highlighting while the boxholder is
// still on the page, and `generateFragment` reports AMBIGUOUS for cases where a
// handcrafted fragment would work
// (github.com/GoogleChromeLabs/text-fragments-polyfill/issues/72), so it is
// optional by design and its absence costs nothing.

import { generateFragment } from "text-fragments-polyfill/dist/fragment-generation-utils.js";
import { processTextFragmentDirective } from "text-fragments-polyfill/text-fragment-utils";

/** What a capture knows about the span it is attached to. */
export interface SelectionAnchor {
  /** The selected text, verbatim. The payload. */
  quoted: string;
  /** Serialized text fragment, when one could be generated. Best-effort. */
  fragment?: string;
  /** The nearest enclosing heading, as plain text. Orientation for a reader. */
  section?: string;
}

const ELEMENT_PREFIX = ":~:element=";
const TARGET_SELECTOR = "[data-comment-target], [role=img], img, svg, canvas, p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, figure, figcaption, table, tr, td, th";

/** Closest visible block or visual element, with a standalone control fallback. */
export function commentTarget(node: Element | null, root: HTMLElement): Element | null {
  if (node !== null && !root.contains(node)) return null;
  let fallback: Element | null = null;
  for (let current = node; current !== null && current !== root; current = current.parentElement) {
    if (!(current instanceof HTMLElement) && !(current instanceof SVGElement)) continue;
    if (!current.matches(TARGET_SELECTOR) && !current.matches("a, button")) continue;
    if (current.getBoundingClientRect().width === 0 || current.getBoundingClientRect().height === 0) continue;
    if (current.matches(TARGET_SELECTOR)) return current;
    fallback ??= current;
  }
  return fallback;
}

function descriptionFor(element: Element): string {
  const caption = element.closest("figure")?.querySelector("figcaption")?.textContent.trim();
  if (element instanceof HTMLImageElement) {
    const source = element.getAttribute("src") ?? "";
    return (caption || element.alt.trim() || (source.startsWith("data:") ? "Inline image" : source) || "Image").slice(0, 10_000);
  }
  const label = element.getAttribute("aria-label")?.trim();
  const text = element.textContent.replace(/\s+/gu, " ").trim();
  return (label || text || caption || element.getAttribute("src") || element.tagName.toLowerCase()).slice(0, 10_000);
}

/** An element path is checked against its tag and quote when read back. */
export function captureElement(root: HTMLElement, element: Element): SelectionAnchor {
  const path: number[] = [];
  let current: Element = element;
  while (current !== root) {
    const parent = current.parentElement;
    if (parent === null) break;
    path.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }
  const quoted = descriptionFor(element);
  const anchor: SelectionAnchor = {
    quoted,
    fragment: serializeElementFragment({ path, tag: element.tagName.toLowerCase() }),
  };
  const section = sectionFor(element, root);
  if (section !== undefined) anchor.section = section;
  return anchor;
}

export function serializeElementFragment(input: { path: number[]; tag: string }): string {
  return `${ELEMENT_PREFIX}${encodeURIComponent(JSON.stringify(input))}`;
}

export function parseElementFragment(fragment: string): { path: number[]; tag: string } | null {
  if (!fragment.startsWith(ELEMENT_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(fragment.slice(ELEMENT_PREFIX.length)));
    if (typeof parsed !== "object" || parsed === null || !("path" in parsed) || !("tag" in parsed)) return null;
    const path: unknown = parsed.path;
    const tag: unknown = parsed.tag;
    if (!Array.isArray(path) || typeof tag !== "string" || path.length === 0 || path.length > 100) return null;
    if (!path.every((index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0)) return null;
    return { path: path.filter((index): index is number => typeof index === "number"), tag };
  } catch (_error) {
    return null;
  }
}

export function findAnchoredElement(input: { root: HTMLElement; fragment: string; quoted: string }): Element | null {
  const { root, fragment, quoted } = input;
  const parsed = parseElementFragment(fragment);
  if (parsed === null) return null;
  try {
    let current: Element = root;
    for (const index of parsed.path) {
      if (!Number.isInteger(index) || index < 0 || index >= current.children.length) return null;
      const child = current.children.item(index);
      if (child === null) return null;
      current = child;
    }
    if (!(current instanceof HTMLElement) && !(current instanceof SVGElement)) return null;
    if (current.tagName.toLowerCase() !== parsed.tag || descriptionFor(current) !== quoted) return null;
    // A shifted path to an identical sibling is indistinguishable from the
    // original. Withhold its marker rather than point at the wrong copy.
    const otherMatches = Array.from(root.querySelectorAll(parsed.tag)).filter((element) =>
      element !== current && !element.contains(current) && !current.contains(element) && descriptionFor(element) === quoted);
    return otherMatches.length === 0 ? current : null;
  } catch (_error) {
    return null;
  }
}

export function isElementFragment(fragment: string): boolean { return fragment.startsWith(ELEMENT_PREFIX); }

/** `#:~:text=` payload shape, as the generator returns it. */
export interface GeneratedFragment {
  prefix?: string;
  textStart?: string;
  textEnd?: string;
  suffix?: string;
}

/** Exported for the round-trip test: these two must be exact inverses. */
export function serializeFragment(fragment: GeneratedFragment): string {
  const encode = (value: string) => encodeURIComponent(value);
  const parts: string[] = [];
  if (fragment.prefix !== undefined && fragment.prefix !== "") parts.push(`${encode(fragment.prefix)}-`);
  if (fragment.textStart !== undefined) parts.push(encode(fragment.textStart));
  if (fragment.textEnd !== undefined && fragment.textEnd !== "") parts.push(encode(fragment.textEnd));
  if (fragment.suffix !== undefined && fragment.suffix !== "") parts.push(`-${encode(fragment.suffix)}`);
  return `:~:text=${parts.join(",")}`;
}

/**
 * The nearest heading above a node in document order — what section of the
 * document this is. Document order, not the sibling chain: a caption inside a
 * figure inside a section has no heading among its ancestors' siblings, yet
 * the heading above that section is plainly what it sits under.
 */
function sectionFor(node: Node, root: HTMLElement): string | undefined {
  let found: Element | undefined;
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const position = heading.compareDocumentPosition(node);
    // FOLLOWING: the node comes after the heading. A selection that starts
    // inside the heading itself (CONTAINED_BY) counts as under it too.
    if ((position & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) === 0) break;
    found = heading;
  }
  const text = found?.textContent.trim();
  return text === undefined || text === "" ? undefined : text;
}

/**
 * Capture the current selection, if it is inside `root` and not empty.
 * Returns null when there is nothing to comment on — an empty selection is the
 * ordinary state, not a failure.
 */
export function captureSelection(root: HTMLElement): SelectionAnchor | null {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const quoted = selection.toString().trim();
  if (quoted === "") return null;

  const anchor: SelectionAnchor = { quoted };
  const section = sectionFor(range.startContainer, root);
  if (section !== undefined) anchor.section = section;

  // AMBIGUOUS and TIMEOUT are ordinary outcomes, not errors: the comment is
  // fully usable without a fragment.
  try {
    const generated = generateFragment(selection);
    // status 0 is SUCCESS. AMBIGUOUS and TIMEOUT land here too and are fine.
    if (generated.status === 0 && generated.fragment !== undefined) {
      anchor.fragment = serializeFragment(generated.fragment);
    }
  } catch (_e) {
    // A generator that throws is the same outcome as one that cannot find a
    // unique fragment: no fragment, quoted text intact.
  }
  return anchor;
}

/** Parse a stored fragment back into the directive shape the matcher wants. */
export function parseFragment(fragment: string): GeneratedFragment | null {
  const payload = fragment.startsWith(":~:text=") ? fragment.slice(":~:text=".length) : fragment;
  const parts = payload.split(",").map((part) => decodeURIComponent(part));
  if (parts.length === 0) return null;
  const directive: GeneratedFragment = {};
  const rest = [...parts];
  const first = rest[0];
  // `rest.length > 1`: a LONE part ending in `-` is the quoted text itself
  // (selecting "foo-" is ordinary), not a prefix with nothing to prefix. Without
  // this the part is shifted away and the whole fragment parses to null, so the
  // comment silently stops highlighting.
  if (first !== undefined && first.endsWith("-") && rest.length > 1) {
    directive.prefix = first.slice(0, -1);
    rest.shift();
  }
  const last = rest.at(-1);
  if (last !== undefined && last.startsWith("-") && rest.length > 1) {
    directive.suffix = last.slice(1);
    rest.pop();
  }
  const [textStart, textEnd] = rest;
  // An EMPTY textStart is not a usable directive — it would ask the matcher to
  // find nothing and take whatever it answered. Absent and empty are the same
  // refusal here.
  if (textStart === undefined || textStart === "") return null;
  directive.textStart = textStart;
  if (textEnd !== undefined) directive.textEnd = textEnd;
  return directive;
}

/**
 * Find a stored comment's span in the rendered document, or null. A comment
 * whose fragment no longer resolves is still shown — in a list, with its
 * `quoted` text — never dropped: an anchoring system whose failure mode is a
 * silently vanished annotation is the one bug this design is built to avoid.
 */
export function findAnchoredRange(root: HTMLElement, fragment: string): Range | null {
  const directive = parseFragment(fragment);
  if (directive === null) return null;
  if (directive.textStart === undefined) return null;
  try {
    // `.at(0)`, not `[0]`: "up to two matches" means the array can be empty.
    return processTextFragmentDirective(
      { ...directive, textStart: directive.textStart },
      document,
      root,
    ).at(0) ?? null;
  } catch (_e) {
    return null;
  }
}

/** Named highlight for anchored comments — see styles.css. */
export const COMMENT_HIGHLIGHT = "bbx-comment-anchor";

/**
 * Highlight ranges through the CSS Custom Highlight API: it mutates no DOM, so
 * it cannot fight React's ownership of the rendered markdown. A no-op where the
 * API is unavailable, exactly as beebox's quote-anchor does.
 */
export function highlightRanges(ranges: Range[]): void {
  if (typeof Highlight === "undefined" || !("highlights" in CSS)) return;
  if (ranges.length === 0) {
    CSS.highlights.delete(COMMENT_HIGHLIGHT);
    return;
  }
  CSS.highlights.set(COMMENT_HIGHLIGHT, new Highlight(...ranges));
}
