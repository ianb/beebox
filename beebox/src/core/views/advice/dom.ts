/**
 * DOM rules of `bbx view check` advice, over the settled render of one check
 * state (docs/plans/box-view-guidance-and-checks.md, Track 3). jsdom does no
 * layout and the check loads no app CSS, so each rule reports only what the
 * markup proves, and never computes an accessible name:
 *
 * - `unnamed-control`: a `button`, `a[href]`, `select`, `textarea`, or
 *   `input` (not hidden, submit, reset, button, image) with no `aria-label`,
 *   `aria-labelledby` or `title` attribute (any value), not inside a
 *   `<label>` and with no `label[for]` naming its id. A `button` or `a` also
 *   has no text and no descendant that may name it (`alt`, `aria-label`,
 *   `aria-labelledby`, `title`, an SVG `<title>`). Not caught, by design: an
 *   empty label, a dangling `aria-labelledby`, text only in an `aria-hidden`
 *   descendant.
 * - `img-without-alt`: an `img` with no `alt` and no `presentation`/`none` role.
 * - `aria-label-without-role`: `div`, `span`, `p`, `i`, `b` with `aria-label`
 *   and no `role` (`personal-vibe-check/rules/aria-label-needs-role.ts`).
 * - `wide-table-without-wrapper`: a `table` whose fullest row has
 *   `WIDE_TABLE_CELLS` or more cells, and no ancestor inside the container
 *   scrolls sideways (`scrollsSideways`), nor the table itself with
 *   `display: block` (a `display: table` box is not a scroll container,
 *   whatever its overflow). The cell count stands in for width, which jsdom
 *   cannot measure.
 *
 * Two skip sets. Not shown: inside `[hidden]`, under computed `display:
 * none`, in a closed `<dialog>`, or in a closed `<details>` outside its
 * `<summary>`. Not exposed: inside `[aria-hidden="true"]` or `[inert]`. The
 * naming rules skip both; the table rule skips only "not shown", because a
 * hidden-from-assistive-technology table still runs off the card.
 */

import { advice, type ViewAdvice } from "./types.js";

/** Cells in a table's fullest row at which it counts as wide. */
export const WIDE_TABLE_CELLS = 4;
const WHERE_MAX = 60;
const CONTROLS = "button, a[href], select, textarea, input";
const UNNAMED_INPUT_TYPES = new Set(["hidden", "submit", "reset", "button", "image"]);
const NAME_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"];
const SCROLLING_CLASSES = new Set(["overflow-x-auto", "overflow-x-scroll", "overflow-auto", "overflow-scroll"]);

/**
 * The computed horizontal overflow: `overflow-x` when set, else the first
 * value of the `overflow` shorthand (CSS Overflow 3: the first value is the x
 * axis). jsdom does not expand the shorthand, so for `overflow-x: hidden;
 * overflow: auto` this says `hidden` where a browser scrolls.
 */
export function horizontalOverflow(style: Pick<CSSStyleDeclaration, "overflowX" | "overflow">): string {
  if (style.overflowX !== "") return style.overflowX;
  return style.overflow.trim().split(/\s+/)[0] ?? "";
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  return el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
}

/** Whether an element scrolls sideways, by its style or a Tailwind class (no app CSS in the check). */
export function scrollsSideways(el: Element): boolean {
  if ([...el.classList].some((c) => SCROLLING_CLASSES.has(c))) return true;
  const style = styleOf(el);
  return style !== null && ["auto", "scroll"].includes(horizontalOverflow(style));
}

/** Elements from `el` up to, not including, `container`. */
function selfAndAncestors(el: Element, container: Element): Element[] {
  const out: Element[] = [];
  for (let current: Element | null = el; current !== null && current !== container; current = current.parentElement) out.push(current);
  return out;
}

function isNotShown(el: Element, container: Element): boolean {
  let below: Element | null = null;
  for (const a of selfAndAncestors(el, container)) {
    if (a.hasAttribute("hidden") || styleOf(a)?.display === "none") return true;
    const closed = !a.hasAttribute("open");
    if (a.localName === "dialog" && closed) return true;
    // In a closed <details>, only its own <summary> shows.
    if (a.localName === "details" && closed && below !== null && below.localName !== "summary") return true;
    below = a;
  }
  return false;
}

function isNotExposed(el: Element, container: Element): boolean {
  return selfAndAncestors(el, container).some((a) => a.getAttribute("aria-hidden") === "true" || a.hasAttribute("inert"));
}

function hasNameAttribute(el: Element): boolean {
  return NAME_ATTRIBUTES.some((name) => el.hasAttribute(name));
}

function isUnnamedControl(el: Element): boolean {
  const tag = el.localName;
  if (tag === "input" && UNNAMED_INPUT_TYPES.has((el.getAttribute("type") ?? "text").toLowerCase())) return false;
  if (hasNameAttribute(el) || el.closest("label") !== null) return false;
  const id = el.getAttribute("id");
  if (id !== null && [...el.ownerDocument.querySelectorAll("label[for]")].some((label) => label.getAttribute("for") === id)) return false;
  if (tag !== "button" && tag !== "a") return true;
  if (el.textContent.trim() !== "") return false;
  return el.querySelector("[alt], [aria-label], [aria-labelledby], [title], svg title") === null;
}

function isImgWithoutAlt(el: Element): boolean {
  const role = el.getAttribute("role");
  return !el.hasAttribute("alt") && role !== "presentation" && role !== "none";
}

function isLabelWithoutRole(el: Element): boolean {
  return el.hasAttribute("aria-label") && !el.hasAttribute("role");
}

function fullestRow(table: Element): number {
  const rows = [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
  return Math.max(0, ...rows.map((row) => [...row.children].filter((c) => c.localName === "td" || c.localName === "th").length));
}

/** Whether the table is itself a scroll container: block display (by style or the Tailwind `block` class) that scrolls sideways. */
function scrollsItself(table: Element): boolean {
  const block = table.classList.contains("block") || styleOf(table)?.display === "block";
  return block && scrollsSideways(table);
}

function isUnwrappedWideTable({ table, container }: { table: Element; container: Element }): boolean {
  if (fullestRow(table) < WIDE_TABLE_CELLS || scrollsItself(table)) return false;
  return !selfAndAncestors(table, container).slice(1).some(scrollsSideways);
}

/** The element's opening tag, cut to `WHERE_MAX` characters. */
function openingTag(el: Element): string {
  const html = el.outerHTML;
  const tag = html.slice(0, html.indexOf(">") + 1);
  return tag.length > WHERE_MAX ? `${tag.slice(0, WHERE_MAX - 1)}…` : tag;
}

/** The DOM advice for one settled render, inside `container`. */
export function domAdvice(container: Element): ViewAdvice[] {
  const found: ViewAdvice[] = [];
  const named = (el: Element) => !isNotShown(el, container) && !isNotExposed(el, container);
  for (const el of container.querySelectorAll(CONTROLS)) {
    if (isUnnamedControl(el) && named(el)) found.push(advice("unnamed-control", openingTag(el)));
  }
  for (const el of container.querySelectorAll("img")) {
    if (isImgWithoutAlt(el) && named(el)) found.push(advice("img-without-alt", openingTag(el)));
  }
  for (const el of container.querySelectorAll("div, span, p, i, b")) {
    if (isLabelWithoutRole(el) && named(el)) found.push(advice("aria-label-without-role", openingTag(el)));
  }
  for (const table of container.querySelectorAll("table")) {
    if (isUnwrappedWideTable({ table, container }) && !isNotShown(table, container)) found.push(advice("wide-table-without-wrapper", openingTag(table)));
  }
  return found;
}
