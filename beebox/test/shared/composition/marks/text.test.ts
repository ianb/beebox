// # Composition text: whitespace normalization
//
// `normalizeComposition` unwraps hard-wrapped paragraphs and list items without
// changing what renders. Copy's forms are tested in `copy.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { normalizeComposition } from "../../../../src/shared/composition/marks/text.js";

// ## A wrapped paragraph joins into one line; the continuation indent goes
void test("wrapped paragraph", async (t) => {
  t.check(normalizeComposition("The garden was\n  Odette's idea. \nWe planted it."), "The garden was Odette's idea. We planted it.");
});

// ## A wrapped list item joins; nested items stay their own lines
void test("wrapped list item", async (t) => {
  t.check(
    normalizeComposition("- beans\n  and peas\n  - pole beans\n    on strings\n- squash"),
    "- beans and peas\n  - pole beans on strings\n- squash",
  );
});

// ## Hard breaks stay: two trailing spaces, or a trailing backslash
void test("hard breaks kept", async (t) => {
  t.check(normalizeComposition("Roses are red,  \nviolets blue.\\\nThe end."), "Roses are red,  \nviolets blue.\\\nThe end.");
  // Trailing spaces at a paragraph's end are not a break, so they go.
  t.check(normalizeComposition("Last line.  \n\nNext."), "Last line.\n\nNext.");
});

// ## Fences, blockquotes, headings, tables, and tag lines keep their lines
void test("structure kept", async (t) => {
  const fence = "```\nkeep   \n  this\n\n\n\nspacing\n```";
  t.check(normalizeComposition(fence), fence);
  const quote = "> a quoted\n> line  ";
  t.check(normalizeComposition(quote), quote);
  t.check(normalizeComposition("# Heading\nText\nwraps.\n\n| a | b |\n|---|---|\n| 1 | 2 |"), "# Heading\nText wraps.\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  t.check(
    normalizeComposition('{% editorial kind="note" %}\nA note\nwrapped.\n{% /editorial %}'),
    '{% editorial kind="note" %}\nA note wrapped.\n{% /editorial %}',
  );
});

// ## Blank-line runs collapse; normalizing twice changes nothing
void test("blank lines and idempotence", async (t) => {
  const messy = "One\ntwo.\n\n\n\nThree  \nfour.\n   \n\n- a\n  b\n\n```\nx\n\n\ny\n```\n";
  const once = normalizeComposition(messy);
  t.check(once, "One two.\n\nThree  \nfour.\n\n- a b\n\n```\nx\n\n\ny\n```\n");
  t.check(normalizeComposition(once), once);
});
