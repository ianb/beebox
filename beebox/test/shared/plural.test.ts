// # plural
//
// A count with its noun for status lines and summaries. Only exactly 1 is
// singular; zero and fractions take the plural. See `src/shared/plural.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { plural } from "../../src/shared/plural.js";

void test("Only a count of exactly 1 is singular", async (t) => {
  t.check([0, 1, 2, 1.5].map((n) => plural(n, "card")), ["0 cards", "1 card", "2 cards", "1.5 cards"]);
});
