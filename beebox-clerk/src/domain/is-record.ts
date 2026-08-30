/**
 * Narrow an `unknown` to a plain string-keyed object (a "record").
 *
 * The blessed alternative to the recurring `value as Record<string, unknown>`
 * cast that follows a `typeof x === "object" && x !== null` check: the cast
 * asserts a shape the runtime never confirmed (an array is also
 * `typeof === "object"`), whereas this is a real guard that excludes `null` and
 * arrays and then narrows, so a caller can index by string key with no further
 * cast. Mirrors beebox's `src/lib/is-record.ts` (clerk is a separate
 * package and can't import engine internals).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
