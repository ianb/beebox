/**
 * Natural ("human") string comparison for sorting file/directory listings.
 *
 * Numeric runs compare by value, not lexically, so `foo-2` < `foo-3` < `foo-20`
 * instead of the plain-`localeCompare` order `foo-2` < `foo-20` < `foo-3`. Only
 * `numeric` is enabled, so case/accent behavior matches the previous plain
 * `a.localeCompare(b)` — this changes number ordering only.
 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
