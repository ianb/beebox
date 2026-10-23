// # valueFlags
//
// `bin/comments` and `bin/schedules` read `--name value` pairs with one rule:
// the value is always the next argument, even when it starts with `--`,
// because it is often a person's own words. See `bin/lib/value-flags.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { valueFlags } from "../../lib/value-flags.js";

void test("A value starting with -- is kept, the last repeat wins, and a trailing flag reads empty", async (t) => {
  const names = new Set(["body", "id"]);
  const args = ["add", "--body", "-- actually, no", "--json", "--id", "a", "--id", "b", "--body"];
  t.check(Object.fromEntries(valueFlags(args, names)), { body: "", id: "b" });
  t.check(Object.fromEntries(valueFlags(["--body", "--id", "x"], names)), { body: "--id" });
});
