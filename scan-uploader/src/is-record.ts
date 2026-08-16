/** Narrows `unknown` to a string-keyed object, in place of `value as Record<string, unknown>`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
