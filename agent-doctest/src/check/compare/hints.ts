/**
 * Mismatch wording that names the likely fix, for mistakes seen in the
 * mistake corpus (plan retire-doctest.md, track V item 3): a misspelled key,
 * a Date compared with a short date, doctest `«»` wildcards inside a
 * `t.check` string, and an array whose items are right but out of order.
 */

import { Pattern } from "../patterns.js";

/** The problem text for two unequal leaf values. */
export function notEqualProblem(actual: unknown, expected: unknown): string {
  if (typeof expected === "string" && /«[^»]*»/.test(expected)) {
    return "not equal; t.check does not read «» wildcards: write a str`...` template with patterns, e.g. str`count: ${any(String)}`";
  }
  if (actual instanceof Date && typeof expected === "string" && !Number.isNaN(actual.getTime())) {
    return `not equal; a Date matches its full ISO string ("${actual.toISOString()}"), a Date, or isoDate()`;
  }
  return "not equal";
}

/** The largest edit distance at which a key counts as a near miss. */
const NEAR = 2;

/** Edit distance, capped: anything past NEAR counts as NEAR + 1. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > NEAR) return NEAR + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length] ?? NEAR + 1;
}

/** The problem text for an expected key the actual lacks, naming a near-miss key the actual has. */
export function missingKeyProblem(key: string, unlisted: readonly string[]): string {
  const near = unlisted.find((k) => distance(k.toLowerCase(), key.toLowerCase()) <= NEAR);
  return near === undefined ? "missing key" : `missing key; the actual has "${near}": is one of them misspelled?`;
}

/**
 * Whether two arrays hold the same plain items in a different order. Only
 * for plain data: an expected pattern could match either way.
 */
export function sameItemsReordered(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  if (actual.length !== expected.length || actual.length < 2) return false;
  const hasPattern = (v: unknown): boolean =>
    v instanceof Pattern || (Array.isArray(v) ? v.some(hasPattern) : typeof v === "object" && v !== null && Object.values(v).some(hasPattern));
  if (expected.some(hasPattern)) return false;
  // JSON.stringify gives no text for these.
  const text = (v: unknown): string => (v === undefined || typeof v === "function" || typeof v === "symbol" ? String(v) : JSON.stringify(v));
  const key = (items: readonly unknown[]): string => items.map(text).toSorted().join("\n");
  try {
    const inOrder = actual.every((v, i) => text(v) === text(expected[i]));
    return !inOrder && key(actual) === key(expected);
  } catch {
    // A value JSON cannot write (a BigInt, a cycle) gets no hint.
    return false;
  }
}

export const REORDERED_PROBLEM = "the same items in another order; if order does not matter, write unordered([...])";
