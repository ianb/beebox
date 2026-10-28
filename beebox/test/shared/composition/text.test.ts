// # Composition text: whitespace normalization and the plain-text copy
//
// `normalizeComposition` unwraps hard-wrapped paragraphs and list items without
// changing what renders. `compositionPlainText` is what Copy puts on the
// clipboard: `source` tags dropped, editorial marks shown in brackets.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { compositionPlainText, normalizeComposition } from "../../../src/shared/composition/text.js";

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

// ## Plain text: each mark kind in brackets, counted as open
void test("plain text with each kind", async (t) => {
  const text = [
    'The garden was Odette\'s idea. {% editorial kind="joiner" %}After that,{% /editorial %} we planted it',
    "every year.",
    "",
    '{% editorial kind="gap" %}The first harvest.{% /editorial %}',
    "",
    'She said {% editorial kind="check" note="unclear" %}a week{% /editorial %}.',
    "",
    '{% editorial kind="note" %}',
    "Should this end here?",
    "{% /editorial %}",
  ].join("\n");
  t.check(compositionPlainText(text), {
    text: "The garden was Odette's idea. [After that,] we planted it every year.\n\n[The first harvest.]\n\nShe said [a week].\n\n[Should this end here?]",
    openMarks: 4,
  });
});

// ## Plain text: `source` tags go and their words stay; tag syntax Markdoc does not process stays
void test("plain text with source", async (t) => {
  const text = [
    'Tomas remembers {% source ref="/_content/people/Tomas.person.card" usage="his telling" %}the hail that June{% /source %}.',
    "",
    "{% source %}",
    "A secondhand paragraph.",
    "{% /source %}",
    "",
    "```{% process=false %}",
    '{% editorial kind="gap" %}literal{% /editorial %}',
    "```",
  ].join("\n");
  t.check(compositionPlainText(text), {
    text: "Tomas remembers the hail that June.\n\nA secondhand paragraph.\n\n```{% process=false %}\n{% editorial kind=\"gap\" %}literal{% /editorial %}\n```",
    openMarks: 0,
  });
});

// ## Plain text: tag syntax inside inline code is literal text, beside a real mark on the same line
void test("plain text with inline code", async (t) => {
  t.check(compositionPlainText('`{% editorial kind="note" %}literal{% /editorial %}` and {% editorial kind="joiner" %}agent{% /editorial %}'), {
    text: '`{% editorial kind="note" %}literal{% /editorial %}` and [agent]',
    openMarks: 1,
  });
});
