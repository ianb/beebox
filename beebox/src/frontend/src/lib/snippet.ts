/**
 * A one-line preview of `value`: whitespace runs collapse to one space, and
 * text longer than `max` characters is cut at `max` with an ellipsis.
 */
export function snippet(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
