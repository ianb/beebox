/**
 * Text comparison behind `t.checkText` and `t.checkThrows`.
 *
 * The expected text may hold `«»` wildcards for the parts that vary (see
 * match.ts). A mismatch comes back with a visual diff (diff.ts), a
 * paste-ready suggested expected text, and a hint for recognized shapes
 * (suggest.ts).
 */

import { buildDiff } from "../diff.js";
import { matchExtractions } from "./match.js";
import { mismatchHint, suggestExpected } from "./suggest.js";

/** The outcome of comparing text; `diff`, `suggested`, and `hint` exist only on failure. */
export type TextComparison =
  | { pass: true }
  | {
      pass: false;
      diff: string;
      /**
       * A paste-ready expected text: the actual text with volatile parts as
       * wildcards and blank lines as `«blankline»`, or the raw actual text
       * when that rewrite would not match.
       */
      suggested: string;
      /** Advice for a recognized mismatch shape (quoted string, boolean), or null */
      hint: string | null;
    };

/** Compare `actual` with `expected`, which may hold `«»` wildcards. */
export function compareText(actual: string, expected: string): TextComparison {
  if (matchExtractions(actual, expected) !== null) return { pass: true };
  return {
    pass: false,
    diff: buildDiff(actual, expected),
    suggested: suggestExpected(actual, expected) ?? actual,
    hint: mismatchHint(actual, expected),
  };
}
