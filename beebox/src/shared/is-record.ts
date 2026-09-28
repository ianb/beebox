/**
 * Narrow an `unknown` to a plain string-keyed object (a "record").
 *
 * The blessed alternative to the recurring `value as Record<string, unknown>`
 * cast that follows a `typeof x === "object"` check: the cast asserts a shape
 * the runtime never confirmed (an array is also `typeof === "object"`), whereas
 * this is a real guard that excludes `null` and arrays and then narrows, so a
 * caller can index by string key with no further cast.
 *
 * Reach for it at untyped boundaries — parsed JSON/YAML, subprocess or HTTP
 * payloads — where you need to probe a few keys off an `unknown` before trusting
 * it. Where a Zod schema exists for the shape, prefer `schema.safeParse`.
 *
 *   const parsed: unknown = JSON.parse(raw);
 *   if (isRecord(parsed) && typeof parsed["id"] === "string") { ... }
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
