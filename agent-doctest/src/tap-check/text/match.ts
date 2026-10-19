/**
 * Wildcard matching for `t.checkText`.
 *
 * Guillemet wildcards («date», «name=*», etc.) allow fuzzy matching
 * against volatile values.
 */

import { compileWildcards } from "../wildcards.js";

/** Extractions: an array of positional captures with named properties. */
export type Extractions = string[] & Record<string, string>;

function emptyExtractions(): Extractions {
  return [] as unknown as Extractions;
}

/**
 * Match actual text against an expected pattern that may contain
 * guillemet wildcards: `«*»`, `«date»`, `«name=type»`, etc. Returns the
 * captures (positional, plus named ones), or null when the text does not match.
 */
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
