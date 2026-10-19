// # A body that repeats its title as a heading
//
// The card page shows the title from `title:`. `leadingTitleHeading` finds a
// body whose first non-blank line is an H1 with the same text, so lint can warn
// and the card view can hide it. The match ignores case and surrounding spaces.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { blankLeadingTitleHeading, leadingTitleHeading } from "../../src/shared/leading-title-heading.js";

void test("line 11", async (t) => {
  t.check(leadingTitleHeading("# Trip Report\n\nWe drove down on Friday.", "Trip Report"), {
    line: 1,
  });

  t.check(leadingTitleHeading("\n\n  # trip report  \nWe drove down.", " Trip Report "), {
    line: 3,
  });

  t.check(leadingTitleHeading("# Trip Report ##\n", "Trip Report"), {
    line: 1,
  });
});

// An H2, an H1 after a paragraph, a heading with emphasis, and an empty title
// do not match:
void test("An H2, an H1 after a paragraph, a heading with emphasis, and an empty title d...", async (t) => {
  t.check(leadingTitleHeading("## Trip Report\n", "Trip Report"), null);

  t.check(leadingTitleHeading("We drove down.\n\n# Trip Report\n", "Trip Report"), null);

  t.check(leadingTitleHeading("# *Trip Report*\n", "Trip Report"), null);

  t.check(leadingTitleHeading("# Trip Report\n", ""), null);

  t.check(leadingTitleHeading("#Trip Report\n", "Trip Report"), null);
});

// `blankLeadingTitleHeading` empties that line instead of removing it, so later
// lines keep their numbers:
void test("blankLeadingTitleHeading empties that line instead of removing it, so later l...", async (t) => {
  t.check(blankLeadingTitleHeading("# Trip Report\nWe drove down.", "Trip Report"), `
We drove down.`);

  t.check(blankLeadingTitleHeading("## Trip Report\nWe drove down.", "Trip Report"), `## Trip Report
We drove down.`);
});
