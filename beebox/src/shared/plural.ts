/**
 * A count with its noun, adding `s` unless the count is exactly 1:
 * `plural(1, "card")` is "1 card", `plural(0, "card")` is "0 cards". English
 * regular plurals only; pass a noun whose plural is `noun + "s"`.
 */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
