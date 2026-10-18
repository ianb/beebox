// # A card's symbol (`shared/card-symbol.ts`, `shared/css-colour.ts`, `shared/graphemes.ts`)
//
// Every card may carry a `symbol` — the small mark that stands for it in a tab
// strip, a listing, or a tile. It is a global field, so no schema declares it, and
// one grouped key rather than several flat ones: `glyph` and `src` are the two
// ways to be a mark, and they sit side by side so an author choosing between them
// sees both.

import { test } from "tap";
import "agent-doctest/tap";
import { CardSymbol, MAX_GLYPH_GRAPHEMES } from "../../src/shared/card-symbol.js";
import { isCssColour } from "../../src/shared/css-colour.js";
import { countGraphemes } from "../../src/shared/graphemes.js";

// ## The group parses, and every key is optional
void test("The group parses, and every key is optional", async (t) => {
  // doctest:L18
  t.check(CardSymbol.parse({ glyph: "🍞", background: "hsl(35 60% 88%)" }), {
    glyph: "🍞",
    background: "hsl(35 60% 88%)",
  });

  // doctest:L21
  t.check(CardSymbol.parse({ src: "/_content/marks/bread.webp" }), {
    src: "/_content/marks/bread.webp",
  });

  // doctest:L24
  t.check(CardSymbol.parse({}), {});

  // A non-string value in a key is a parse failure, like any other mistyped field —
  // the lenient handling is for a *string* that is not a colour, not for a number
  // where a string belongs.

  // doctest:L33
  t.check(CardSymbol.safeParse({ background: 3 }).success, false);
});

// ## Graphemes, not code points, decide whether a glyph is short
//
// This is the whole reason `countGraphemes` exists. A single emoji is routinely
// several code points, so `.length` would reject marks that are obviously one
// mark — and a two-letter abbreviation, which an author may deliberately ask for,
// is two.
void test("This is the whole reason countGraphemes exists.", async (t) => {
  // doctest:L45
  const family = "👨‍👩‍👧‍👦";
  const scotland = "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
  const kiss = "👨🏻‍❤️‍💋‍👨🏽";

  // doctest:L49
  t.check([countGraphemes(family), countGraphemes(scotland), countGraphemes(kiss)].join(","), "1,1,1");

  // doctest:L52
  t.check([countGraphemes("AB"), countGraphemes("recipe"), countGraphemes("")].join(","), "2,6,0");

  // Every one of those emoji is well inside the cap, which is what a code-point cap
  // of the same size would have got wrong: the kiss alone is ten code points.

  // doctest:L60
  t.check([countGraphemes(kiss) <= MAX_GLYPH_GRAPHEMES, [...kiss].length <= MAX_GLYPH_GRAPHEMES].join(","), "true,false");
});

// ## Colours: six forms, and nothing else
void test("Colours: six forms, and nothing else", async (t) => {
  // doctest:L67
  await t.checkText(
    ["#3a7", "#33aa77", "hsl(210 40% 50%)", "hsla(210, 40%, 50%, .5)", "rgb(1 2 3)", "rgba(1, 2, 3, .5)"]
      .every(isCssColour),
    "true",
  );

  // Named colours and modern syntaxes are refused on purpose: the only complete
  // validator is `CSS.supports()`, which does not exist in Node, so a small
  // vocabulary is the honest one. A nested function cannot sneak through, because
  // parentheses are not in the accepted character set.

  // doctest:L78
  await t.checkText(
    ["rebeccapurple", "color-mix(in srgb, red, blue)", "oklch(70% 0.1 200)", "#3a7f", "", "  ",
     "javascript:alert(1)", "rgb(url(evil))", "hsl(210 40% 50%); background: red",
     "rgb(foo)", "hsl(degdeg)"].some(isCssColour),
    "false",
  );

  // Letters are admitted only as a unit directly after a number, so the modern
  // slash-alpha and angle forms pass while junk inside the parentheses does not.

  // doctest:L88
  await t.checkText(["rgb(1 2 3 / 50%)", "hsl(0.5turn 40% 50%)", "rgb(1,2,3)"].every(isCssColour), "true");

  // Whitespace around a value is tolerated — a hand-authored card should not fail on
  // a trailing space.

  // doctest:L96
  t.check(isCssColour("  #3a7  "), true);
});
