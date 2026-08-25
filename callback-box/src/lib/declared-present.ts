/**
 * Check a value that a third-party type declares as always present.
 *
 * A dependency's `.d.ts` is a claim about the data it emits, not a proof. Where
 * the declared type says a field is always there, TypeScript removes the check
 * and a property read on it becomes a bare `TypeError` ("Cannot read properties
 * of undefined") if the claim ever fails — thrown from inside our code, with no
 * name for what was missing.
 *
 * `declaredPresent` re-opens the check without a cast: it widens the value to
 * `T | null`, so the caller can branch on it and report the gap in its own words
 * instead of letting the read throw. Use it at a boundary where an external
 * stream or SDK hands over data — not on our own values, where a missing field
 * is a bug to fix rather than a case to handle.
 *
 *   const item = declaredPresent(event.item);
 *   if (item === null) { console.warn("… emitted item.completed with no item"); return; }
 */
export function declaredPresent<T>(value: T): NonNullable<T> | null {
  return value ?? null;
}
