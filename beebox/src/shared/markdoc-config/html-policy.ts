/**
 * The raw-HTML allow-list for Markdown bodies.
 *
 * Markdoc ships with raw HTML off. We turn markdown-it's HTML recognition on
 * and then rebuild every HTML fragment as a Markdoc node (`html-tokens.ts`),
 * so raw HTML text never reaches `innerHTML`: React and Markdoc's HTML
 * renderer only see element names and attribute values that pass this file.
 * A tag that is not listed here stays literal text, as before.
 *
 * `a` and `img` are absent on purpose: `html-tokens.ts` rewrites them into
 * Markdown link and image nodes, so they take the same URL checks, in-box
 * routing, ref tracking and image proxying as `[text](url)` and `![](src)`.
 *
 * Pure TypeScript, shared by the frontend and backend (see `core.ts`).
 */

/** How an allowed element participates in markdown-it's block/inline split. */
export type HtmlElementLevel = "inline" | "block";

interface ElementRule {
  level: HtmlElementLevel;
  /** Void element: no children, no close tag. */
  void?: boolean;
  /** Attributes allowed on this element, beyond {@link GLOBAL_ATTRIBUTES}. */
  attributes?: readonly AttributeName[];
  /**
   * Open elements this element's start tag closes implicitly, as an HTML
   * parser would (`<td>` after `<td>`, `<li>` after `<li>`). Only checked
   * against the innermost open elements of the same container.
   */
  closes?: readonly string[];
}

type AttributeName =
  | "align"
  | "colspan"
  | "rowspan"
  | "open"
  | "start"
  | "reversed"
  | "type"
  | "value";

const GLOBAL_ATTRIBUTES = ["title", "lang", "dir"] as const;

const ALIGN: readonly AttributeName[] = ["align"];
const CELL_CLOSES = ["td", "th"] as const;
const ROW_CLOSES = ["tr", "td", "th"] as const;
const SECTION_CLOSES = ["thead", "tbody", "tfoot", "tr", "td", "th"] as const;

const INLINE: ElementRule = { level: "inline" };

const ELEMENTS: Readonly<Record<string, ElementRule>> = {
  // Phrasing content.
  br: { level: "inline", void: true },
  wbr: { level: "inline", void: true },
  sub: INLINE,
  sup: INLINE,
  kbd: INLINE,
  mark: INLINE,
  ins: INLINE,
  del: INLINE,
  s: INLINE,
  u: INLINE,
  b: INLINE,
  i: INLINE,
  strong: INLINE,
  em: INLINE,
  code: INLINE,
  small: INLINE,
  abbr: INLINE,
  q: INLINE,
  cite: INLINE,
  dfn: INLINE,
  var: INLINE,
  samp: INLINE,
  span: INLINE,
  ruby: INLINE,
  rt: INLINE,
  rp: INLINE,
  // Block content.
  p: { level: "block", attributes: ALIGN, closes: ["p"] },
  div: { level: "block", attributes: ALIGN, closes: ["p"] },
  blockquote: { level: "block", closes: ["p"] },
  hr: { level: "block", void: true, closes: ["p"] },
  h1: { level: "block", attributes: ALIGN, closes: ["p"] },
  h2: { level: "block", attributes: ALIGN, closes: ["p"] },
  h3: { level: "block", attributes: ALIGN, closes: ["p"] },
  h4: { level: "block", attributes: ALIGN, closes: ["p"] },
  h5: { level: "block", attributes: ALIGN, closes: ["p"] },
  h6: { level: "block", attributes: ALIGN, closes: ["p"] },
  details: { level: "block", attributes: ["open"], closes: ["p"] },
  summary: { level: "block" },
  ul: { level: "block", closes: ["p"] },
  ol: { level: "block", attributes: ["start", "reversed", "type"], closes: ["p"] },
  li: { level: "block", attributes: ["value"], closes: ["li", "p"] },
  dl: { level: "block", closes: ["p"] },
  dt: { level: "block", closes: ["dt", "dd", "p"] },
  dd: { level: "block", closes: ["dt", "dd", "p"] },
  table: { level: "block", attributes: ALIGN, closes: ["p"] },
  caption: { level: "block", attributes: ALIGN },
  thead: { level: "block", attributes: ALIGN, closes: SECTION_CLOSES },
  tbody: { level: "block", attributes: ALIGN, closes: SECTION_CLOSES },
  tfoot: { level: "block", attributes: ALIGN, closes: SECTION_CLOSES },
  tr: { level: "block", attributes: ALIGN, closes: ROW_CLOSES },
  th: { level: "block", attributes: ["align", "colspan", "rowspan"], closes: CELL_CLOSES },
  td: { level: "block", attributes: ["align", "colspan", "rowspan"], closes: CELL_CLOSES },
};

/** The rule for an allowed element name (lowercase), or `undefined` when it is not allowed. */
export function htmlElementRule(name: string): ElementRule | undefined {
  return Object.hasOwn(ELEMENTS, name) ? ELEMENTS[name] : undefined;
}

const ALIGN_VALUES = new Set(["left", "center", "right", "justify"]);
const DIR_VALUES = new Set(["ltr", "rtl", "auto"]);
const OL_TYPES = new Set(["1", "a", "A", "i", "I"]);
const POSITIVE_INT = /^\d{1,4}$/;

/**
 * Attribute value checks. A value that fails is dropped, not escaped. The
 * returned name is the React spelling: Markdoc's HTML renderer lowercases
 * attribute names, so `colSpan` serves both renderers.
 */
const ATTRIBUTE_CHECKS: Readonly<Record<string, (value: string | true) => [string, string | true] | null>> = {
  title: (v) => (typeof v === "string" ? ["title", v] : null),
  lang: (v) => (typeof v === "string" && /^[A-Za-z]{1,8}(?:-[\dA-Za-z]{1,8})*$/.test(v) ? ["lang", v] : null),
  dir: (v) => (typeof v === "string" && DIR_VALUES.has(v.toLowerCase()) ? ["dir", v.toLowerCase()] : null),
  align: (v) => (typeof v === "string" && ALIGN_VALUES.has(v.toLowerCase()) ? ["align", v.toLowerCase()] : null),
  colspan: (v) => (typeof v === "string" && POSITIVE_INT.test(v) ? ["colSpan", v] : null),
  rowspan: (v) => (typeof v === "string" && POSITIVE_INT.test(v) ? ["rowSpan", v] : null),
  start: (v) => (typeof v === "string" && POSITIVE_INT.test(v) ? ["start", v] : null),
  value: (v) => (typeof v === "string" && POSITIVE_INT.test(v) ? ["value", v] : null),
  type: (v) => (typeof v === "string" && OL_TYPES.has(v) ? ["type", v] : null),
  open: () => ["open", true],
  reversed: () => ["reversed", true],
};

/** Result of filtering an element's authored attributes. */
export interface FilteredAttributes {
  /** Allowed attributes under their render names. */
  kept: Record<string, string | true>;
  /** Authored attribute names that were dropped (not allowed, or a bad value). */
  dropped: string[];
}

/**
 * Keep the allowed attributes of an allowed element. `attributes` holds the
 * authored names (any case) and decoded values; a valueless attribute is `true`.
 */
export function filterHtmlAttributes(element: string, attributes: readonly (readonly [string, string | true])[]): FilteredAttributes {
  const rule = htmlElementRule(element);
  const allowed = new Set<string>([...GLOBAL_ATTRIBUTES, ...(rule?.attributes ?? [])]);
  const kept: Record<string, string | true> = {};
  const dropped: string[] = [];
  for (const [rawName, value] of attributes) {
    const name = rawName.toLowerCase();
    const check = allowed.has(name) ? ATTRIBUTE_CHECKS[name] : undefined;
    const result = check?.(value) ?? null;
    if (result === null) {
      dropped.push(rawName);
      continue;
    }
    kept[result[0]] = result[1];
  }
  return { kept, dropped };
}

/** Render names of every attribute any allowed element can carry, for the Markdoc tag schema. */
export const HTML_RENDER_ATTRIBUTES = [
  "title",
  "lang",
  "dir",
  "align",
  "colSpan",
  "rowSpan",
  "start",
  "value",
  "type",
  "open",
  "reversed",
] as const;
