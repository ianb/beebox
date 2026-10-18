// # Main dev-router defaults
//
// Real local boxes belong in the main checkout's gitignored `beebox/.env`
// `BOXES=` line. Tracked source falls back only to the conventional test fixture.

import { test } from "tap";
import "agent-doctest/tap";
import path from "node:path";
import { MAIN_BOX_DEFAULTS } from "../../../src/router/server/config.js";

void test("line 11", async (t) => {
  // doctest:L12
  t.check(MAIN_BOX_DEFAULTS.map((boxPath) => path.basename(boxPath)), [
    "test1",
  ]);
});
