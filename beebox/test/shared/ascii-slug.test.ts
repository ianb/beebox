// # asciiSlug
//
// Lowercase, runs of non `a-z0-9` become `-`, edge dashes trimmed.
// See `src/shared/ascii-slug.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { asciiSlug } from "../../src/shared/ascii-slug.js";

void test("Punctuation and padding collapse to single dashes with none at the ends", async (t) => {
  t.check(asciiSlug("  Hello, World!  "), "hello-world");

  t.check(asciiSlug("--a--b--"), "a-b");

  t.check(asciiSlug("Ünïcode"), "n-code");

  t.check(asciiSlug(""), "");
});
