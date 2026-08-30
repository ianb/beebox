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

/** `#:~:text=` payload shape, as the generator returns it. */
export interface GeneratedFragment {
  prefix?: string;
  textStart?: string;
  textEnd?: string;
  suffix?: string;
}

/** Exported for the round-trip doctest: these two must be exact inverses. */
export function serializeFragment(fragment: GeneratedFragment): string {
  const encode = (value: string) => encodeURIComponent(value);
  const parts: string[] = [];
  if (fragment.prefix !== undefined && fragment.prefix !== "") parts.push(`${encode(fragment.prefix)}-`);
  if (fragment.textStart !== undefined) parts.push(encode(fragment.textStart));
  if (fragment.textEnd !== undefined && fragment.textEnd !== "") parts.push(encode(fragment.textEnd));
  if (fragment.suffix !== undefined && fragment.suffix !== "") parts.push(`-${encode(fragment.suffix)}`);
  return `:~:text=${parts.join(",")}`;
}

/** The nearest heading above a node — what section of the document this is. */
function sectionFor(node: Node, root: HTMLElement): string | undefined {
  let element: Element | null = node instanceof Element ? node : node.parentElement;
  while (element !== null && element !== root) {
    let sibling: Element | null = element.previousElementSibling;
    while (sibling !== null) {
      if (/^H[1-6]$/u.test(sibling.tagName)) return sibling.textContent.trim();
      sibling = sibling.previousElementSibling;
    }
    element = element.parentElement;
  }
  return undefined;
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
