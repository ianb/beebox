/**
 * An approximation of the accname algorithm, in page JavaScript.
 *
 * There is no shipped web API for reading a computed accessible name from
 * inside the page (`getComputedAccessibleNode` ships nowhere we target, and
 * Playwright's snapshot runs over CDP, outside the page), so the scan has to
 * compute one. This is the hand-rolled fallback chain for the cases this app
 * actually produces, not a spec implementation: it stops at the first non-empty
 * result of
 *
 *   `aria-labelledby` → `aria-label` → `alt` → visible text content
 *   (excluding `aria-hidden` subtrees) → `title` → `placeholder`
 *
 * `title` sits above `placeholder` and below text content because 138 `title`
 * attributes carry real names here — the whole send/dictation cluster is
 * `title`-only — while the composer textarea has only
 * `placeholder="Type a message..."`.
 *
 * A control that yields nothing is dropped from the dump by the caller rather
 * than emitted with an empty name; the drop is counted, so the omission is
 * visible instead of silent.
 */

import type { ScanElement, ScanNode } from "./types.js";

/** How the name computation reaches `aria-labelledby` targets. */
export interface NameLookup {
  /** The element carrying this DOM id, or null. */
  byId: (id: string) => ScanElement | null;
}

/** Tags whose `alt` attribute names them. */
const ALT_TAGS = new Set(["img", "area"]);

function attr(element: ScanElement, name: string): string | null {
  const value = element.attributes[name];
  return value === undefined ? null : value;
}

/** Collapse runs of whitespace, as accname's flat-string step does. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function namesAlt(element: ScanElement): boolean {
  if (ALT_TAGS.has(element.tag)) return true;
  return element.tag === "input" && attr(element, "type") === "image";
}

/**
 * Text of the subtree, skipping `aria-hidden` and `hidden` branches. Menu items
 * are the shape this exists for: `<span aria-hidden="true">{icon}</span>` beside
 * `<span>Attach file…</span>` must name the item "Attach file…", not "📎 Attach
 * file…" with a stray glyph.
 */
function visibleText(node: ScanNode): string {
  if (node.kind === "text") return node.text;
  if (attr(node, "aria-hidden") === "true") return "";
  if (attr(node, "hidden") !== null) return "";
  return node.children.map(visibleText).join("");
}

interface NameOptions extends NameLookup {
  /**
   * False while computing the name of an `aria-labelledby` target, so a pair of
   * elements pointing at each other cannot recurse forever.
   */
  followLabelledby: boolean;
}

function nameFrom(element: ScanElement, options: NameOptions): string {
  const labelledby = attr(element, "aria-labelledby");
  if (options.followLabelledby && labelledby !== null) {
    const parts = labelledby
      .split(/\s+/)
      .filter((id) => id !== "")
      .map((id) => {
        const target = options.byId(id);
        if (target === null) return "";
        return nameFrom(target, { byId: options.byId, followLabelledby: false });
      })
      .filter((part) => part !== "");
    const joined = flatten(parts.join(" "));
    if (joined !== "") return joined;
  }

  const label = attr(element, "aria-label");
  if (label !== null && flatten(label) !== "") return flatten(label);

  if (namesAlt(element)) {
    const alt = attr(element, "alt");
    if (alt !== null && flatten(alt) !== "") return flatten(alt);
  }

  const text = flatten(element.children.map(visibleText).join(""));
  if (text !== "") return text;

  const title = attr(element, "title");
  if (title !== null && flatten(title) !== "") return flatten(title);

  const placeholder = attr(element, "placeholder");
  if (placeholder !== null && flatten(placeholder) !== "") return flatten(placeholder);

  return "";
}

/**
 * The element's accessible name, or `""` when it has none the agent could use
 * in prose and the user could recognise.
 */
export function computeAccessibleName(element: ScanElement, lookup: NameLookup): string {
  return nameFrom(element, { byId: lookup.byId, followLabelledby: true });
}
