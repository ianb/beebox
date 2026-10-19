// # Natural sort
//
// `naturalCompare` sorts strings the way a human reads file listings: numeric runs
// compare by value, so `foo-2` comes before `foo-3` comes before `foo-20` — not the
// lexical order (`foo-2`, `foo-20`, `foo-3`) that plain `localeCompare` produces.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { naturalCompare } from "../../src/shared/natural-sort.js";

// ## Numeric suffixes sort by value, not lexically
void test("Numeric suffixes sort by value, not lexically", async (t) => {
  // doctest:L14
  const names = ["foo-3", "foo-20", "foo-2", "foo-1", "foo-10"];
  t.check(names.toSorted(naturalCompare), [
    "foo-1",
    "foo-2",
    "foo-3",
    "foo-10",
    "foo-20",
  ]);
});

// ## Non-numeric names still sort as before, and numbers embedded mid-name work
void test("Non-numeric names still sort as before, and numbers embedded mid-name work", async (t) => {
  // doctest:L27
  const mixed = ["b", "a10", "a2", "a1", "c"];
  t.check(mixed.toSorted(naturalCompare), [
    "a1",
    "a2",
    "a10",
    "b",
    "c",
  ]);
});
