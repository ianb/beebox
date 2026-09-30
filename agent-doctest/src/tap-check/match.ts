/**
 * Wildcard matching for check() assertions.
 *
 * Guillemet wildcards («date», «name=*», etc.) allow fuzzy matching
 * against volatile values. On mismatch, a human-readable diff is
 * produced showing exactly where things diverge (see diff.ts).
 */

import { buildDiff } from "./diff.js";
import { compileWildcards } from "./wildcards.js";

/** Extractions: an array of positional captures with named properties. */
export type Extractions = string[] & Record<string, string>;

export function emptyExtractions(): Extractions {
  return [] as unknown as Extractions;
}

export type MatchResult =
  | { matched: true; diff: null; extractions: Extractions }
  | { matched: false; diff: string; extractions: Extractions };

/**
 * Match actual text against an expected pattern that may contain wildcards.
 *
 * Guillemet wildcards: «*», «date», «name=type», etc.
 *
 * Returns a MatchResult with extractions on success.
 */
export function matchWithWildcards(actual: string, expected: string): MatchResult {
  const extractions = matchExtractions(actual, expected);
  if (extractions === null) {
    return { matched: false, diff: buildDiff(actual, expected), extractions: emptyExtractions() };
  }
  return { matched: true, diff: null, extractions };
}

/** Like matchWithWildcards, without building a diff. Null when it does not match. */
export function matchExtractions(actual: string, expected: string): Extractions | null {
  // Fast path: no wildcards
  if (!expected.includes("«")) {
    return actual === expected ? emptyExtractions() : null;
  }

  const { re, tokens } = compileWildcards(expected);
  const match = re.exec(actual);
  if (!match) return null;

  // Build extractions from capture groups
  const extractions = emptyExtractions();
  let groupIdx = 1;
  for (const token of tokens) {
    const value = match[groupIdx++] ?? "";
    extractions.push(value);
    if (token.name !== null && !(token.name in extractions)) {
      (extractions as Record<string, string>)[token.name] = value;
    }
  }
  return extractions;
}
