// # Optional string helpers
//
// Three rules for reading an optional string off an `unknown`: any string,
// non-empty, and non-blank (original value returned untrimmed).
// See `src/shared/optional-string.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { nonBlankString, nonEmptyString, stringOrNull } from "../../src/shared/optional-string.js";

void test("Each helper keeps or drops the empty, blank, padded, and non-string inputs by its own rule", async (t) => {
  const inputs: unknown[] = ["", " ", "a", " a ", 1, null];
  t.check(
    inputs.map((input) => [stringOrNull(input), nonEmptyString(input), nonBlankString(input)]),
    [
      ["", null, null],
      [" ", " ", null],
      ["a", "a", "a"],
      [" a ", " a ", " a "],
      [null, null, null],
      [null, null, null],
    ],
  );
});
