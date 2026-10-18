// prepare points references at a converted file, but only whole paths: a
// shorter form must not rewrite part of a longer path to another doctest.

import { test } from "tap";
import "agent-doctest/tap";
import { replacePath } from "../../doctest-convert/prepare.ts";

void test("a path is replaced only where it starts", async (t) => {
  const text = "See test/lib/env.doctest.md and src/frontend/test/lib/env.doctest.md (`test/lib/env.doctest.md`).";
  t.check(replacePath(text, { from: "test/lib/env.doctest.md", to: "test/lib/env.test.ts" }), "See test/lib/env.test.ts and src/frontend/test/lib/env.doctest.md (`test/lib/env.test.ts`).");
});
