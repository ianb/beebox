/**
 * Which card types can be shown in a conversation's strip
 * (`docs/plans/conversation-strip.md`).
 *
 * A type is strip-capable when a built-in renderer declares a strip
 * rendering (listed here) or a box view bound to the type lists `"strip"`
 * in its `modes`. The server uses this to accept or refuse
 * `bbx chat strip set`; the page uses the same rule to pick the view, so a
 * card the command accepted is a card the page can draw.
 */

/** Card types whose built-in renderer has a strip rendering. */
export const BUILTIN_STRIP_TYPES: readonly string[] = ["tour"];

/** True when a built-in renderer draws this type in the strip. */
export function isBuiltinStripType(type: string): boolean {
  return BUILTIN_STRIP_TYPES.includes(type);
}

/** The feature value for a conversation with no strip. */
export const STRIP_NONE = "none";
/** The feature value after the person closes the strip. */
export const STRIP_DISMISSED = "dismissed";

/**
 * True for a value that names a card by box path: it starts with `/`, ends
 * with `.card`, and has no `..` segment. This is the shape check only; the
 * strip route resolves the path and checks that the card exists.
 */
export function isBoxCardPath(value: string): boolean {
  if (!value.startsWith("/") || !value.endsWith(".card")) return false;
  return !value.split("/").includes("..");
}

/** The card path a `strip` feature value shows, or null for `none`, `dismissed`, or anything malformed. */
export function stripCardPath(value: string | undefined): string | null {
  if (value === undefined || !isBoxCardPath(value)) return null;
  return value;
}

/** The part of a box view's metadata the strip rule reads. */
export interface StripViewCandidate {
  slug: string;
  modes: readonly string[];
  rendersCardTypes: readonly string[];
}

/**
 * The box view that draws `type` in the strip: among views that render the
 * type and list `"strip"` in `modes`, the first by slug order. Null when
 * none does. A page-only view for the same type never shadows a strip view.
 */
export function stripViewFor<T extends StripViewCandidate>(views: readonly T[], type: string): T | null {
  const eligible = views.filter((view) => view.rendersCardTypes.includes(type) && view.modes.includes("strip"));
  return eligible.toSorted((a, b) => a.slug.localeCompare(b.slug)).at(0) ?? null;
}
