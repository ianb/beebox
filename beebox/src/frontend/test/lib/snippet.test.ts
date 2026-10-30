// A one-line preview collapses whitespace and cuts long text at the limit with
// an ellipsis; text at or under the limit is left whole.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { snippet } from "../../src/lib/snippet.js";

void test("collapses whitespace and cuts at the limit", async (t) => {
  t.check([snippet("  two\n\nlines  ", 32), snippet("abcdef", 6), snippet("abcdefg", 6)], ["two lines", "abcdef", "abcdef…"]);
});
