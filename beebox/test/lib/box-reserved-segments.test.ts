// # Below-root reserved area names
//
// `findReservedNestedSegment` (`src/lib/box-reserved-segments.ts`) finds the
// first below-root segment naming a non-nestable underscore area
// (`issues/features/2026-09-05-disallow-underscore-area-names-below-root.md`).
// `_tmp` may nest; `_config/_template-updates/` is exempt as a subtree (it
// mirrors box-relative destination paths).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { findReservedNestedSegment, reservedNestedSegmentMessage } from "../../src/lib/box-reserved-segments.js";

// ## Nested area names are violations; the first segment never is
void test("Nested area names are violations; the first segment never is", async (t) => {
  t.check(findReservedNestedSegment("_content/recipes/_config/x.card"), "_config");

  t.check(findReservedNestedSegment("_content/_content"), "_content");

  t.check(findReservedNestedSegment("_bookkeeping/jobs/_publish"), "_publish");

  t.check(findReservedNestedSegment("_content/recipes/Bread.recipe.card"), null);

  t.check(findReservedNestedSegment("_config/schemas/foo.ts"), null);

  t.check(findReservedNestedSegment(""), null);
});

// ## `_tmp` nests; other below-root underscore names are not this check's concern
//
// An ad hoc underscore name below the root (`_unsure` is real triage data) is
// legal — only the four area names are reserved words:
void test("An ad hoc underscore name below the root (unsure is real triage data) is lega...", async (t) => {
  t.check(findReservedNestedSegment("_content/scratch/_tmp/x.txt"), null);

  t.check(findReservedNestedSegment("_content/inbox/triaged/_unsure/y.doc.card"), null);
});

// ## The template-updates mirror is exempt
void test("The template-updates mirror is exempt", async (t) => {
  t.check(findReservedNestedSegment("_config/_template-updates/_content/briefing.md"), null);
});

// But only as that exact subtree — a sibling spelling is not:
void test("But only as that exact subtree — a sibling spelling is not:", async (t) => {
  t.check(findReservedNestedSegment("_config/_template-updates-old/_content/briefing.md"), "_content");
});

// ## The message names the reserved word and the exception
void test("The message names the reserved word and the exception", async (t) => {
  t.check(reservedNestedSegmentMessage("_content/recipes/_config/x.card", "_config"), "_content/recipes/_config/x.card: \"_config\" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry");
});
