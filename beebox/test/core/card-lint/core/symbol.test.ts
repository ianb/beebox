// # Linting a card's symbol (`core/lint-symbol.ts`)
//
// One error and four warnings. The severities are the design: a glyph that is a
// sentence means the author misunderstood the field, and letting that reach a
// commit spreads the misunderstanding — everything else about a mark is cosmetic,
// and a card must stay loadable and openable whatever is wrong with it.

import { test } from "tap";
import "agent-doctest/tap";
import { symbolIssues } from "../../../../src/core/card-lint/core/symbol.js";

/** The issues for one `symbol` value, as "severity: message" lines. */
function issues(symbol: unknown): string {
  return symbolIssues({ symbol }).map((i) => `${i.severity}: ${i.message}`).join("\n");
}

// ## A well-formed symbol says nothing
void test("A well-formed symbol says nothing", async (t) => {
  // doctest:L20
  t.check(issues({ glyph: "🍞", background: "hsl(35 60% 88%)" }), "");

  // doctest:L23
  t.check(issues({ src: "/_content/marks/bread.webp" }), "");

  // doctest:L26
  t.check(issues({ glyph: "AB", foreground: "#333", background: "#eee" }), "");

  // A card with no symbol at all is the common case, and is silent.

  // doctest:L33
  await t.checkText(symbolIssues({ title: "Sourdough Bread" }).length, "0");
});

// ## A glyph longer than the cap is an error
//
// Eight graphemes is generous — every emoji is one — so passing it means the
// field was read as a label.
void test("Eight graphemes is generous — every emoji is one — so passing it means the fi...", async (t) => {
  // doctest:L43
  t.check(issues({ glyph: "sourdough bread" }), "error: symbol.glyph is longer than 8 characters — a symbol is a mark, not a label: an emoji, or a letter or two");

  // A single emoji is never long, however many code points it takes, and eight
  // letters is exactly at the cap rather than over it.

  // doctest:L51
  t.check(issues({ glyph: "👨🏻‍❤️‍💋‍👨🏽" }), "");

  // doctest:L54
  t.check(issues({ glyph: "ABCDEFGH" }), "");
});

// ## Glyph and src are alternatives
void test("Glyph and src are alternatives", async (t) => {
  // doctest:L61
  t.check(issues({ glyph: "🍞", src: "/_content/marks/bread.webp" }), "warning: symbol carries both glyph and src — they are alternatives, and src is what renders");

  // An empty group renders nothing, which is an author who meant something.

  // doctest:L68
  t.check(issues({}), "warning: symbol has neither glyph nor src, so nothing renders — remove it, or give it one");

  // doctest:L71
  t.check(issues({ glyph: "   " }), "warning: symbol has neither glyph nor src, so nothing renders — remove it, or give it one");
});

// ## A path in `glyph` is the mistake the adjacent keys invite
void test("A path in `glyph` is the mistake the adjacent keys invite", async (t) => {
  // doctest:L78
  t.check(issues({ glyph: "a/b" }), "warning: symbol.glyph looks like a file path — an image mark goes in symbol.src");

  // doctest:L81
  t.check(issues({ glyph: "b.png" }), "warning: symbol.glyph looks like a file path — an image mark goes in symbol.src");

  // A real path trips both rules, which is the honest report: it is too long AND it
  // belongs in the other key.

  // doctest:L89
  await t.checkText(issues({ glyph: "/_content/marks/bread.webp" }), `error: symbol.glyph is longer than 8 characters — a symbol is a mark, not a label: an emoji, or a letter or two
warning: symbol.glyph looks like a file path — an image mark goes in symbol.src`);
});

// ## A colour outside the accepted forms is ignored, not fatal
void test("A colour outside the accepted forms is ignored, not fatal", async (t) => {
  // doctest:L97
  t.check(issues({ glyph: "🍞", background: "rebeccapurple" }), "warning: symbol.background is not a colour this box accepts (#rgb, #rrggbb, hsl(), hsla(), rgb(), or rgba()) — it is ignored");

  // doctest:L100
  t.check(issues({ glyph: "🍞", foreground: "color-mix(in srgb, red, blue)" }), "warning: symbol.foreground is not a colour this box accepts (#rgb, #rrggbb, hsl(), hsla(), rgb(), or rgba()) — it is ignored");

  // Both wrong at once reports both, in key order.

  // doctest:L107
  await t.checkText(issues({ glyph: "🍞", foreground: "red", background: "blue" }), `warning: symbol.foreground is not a colour this box accepts (#rgb, #rrggbb, hsl(), hsla(), rgb(), or rgba()) — it is ignored
warning: symbol.background is not a colour this box accepts (#rgb, #rrggbb, hsl(), hsla(), rgb(), or rgba()) — it is ignored`);
});

// ## A `symbol` that is not an object is left to Zod
//
// The schema rejects it on load with the usual type error; the lint has nothing to
// add and must not double-report.
void test("The schema rejects it on load with the usual type error; the lint has nothing...", async (t) => {
  // doctest:L118
  await t.checkText(symbolIssues({ symbol: "🍞" }).length, "0");
});
