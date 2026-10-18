// # What a pinned sidecar tab shows (`tab-identity.ts`)
//
// A pinned tab is compact, so it shows one thing: its mark when that mark says
// which card it is, an abbreviation when it doesn't. The rule the boxholder asked
// for is browser-pinned-tab behaviour plus a discriminator — and the discriminator
// is why ambiguity has to be defined carefully.

import { test } from "tap";
import "agent-doctest/tap";
import { abbreviateTitle, ambiguousMarks, pinnedFace } from "../../../../../src/components/chat/workspace/SidecarTabStrip/tab-identity.js";

type PinnedSymbol = Parameters<typeof pinnedFace>[0]["symbol"];

/** A pinned tab's face as "mark|abbreviation", with "-" for an absent half. */
function face(symbol: PinnedSymbol, { title, ambiguous }: { title: string; ambiguous: ReadonlySet<string> }): string {
  const f = pinnedFace({ symbol, title, ambiguous });
  const mark = f.mark?.glyph ?? (f.mark?.src === undefined ? "-" : "[image]");
  return `${mark}|${f.abbreviation ?? "-"}`;
}

// ## Abbreviating a title
//
// Initials of the first two words; a single word gives its first two graphemes.
// Both uppercased, so a strip of abbreviations reads as marks rather than as
// truncated prose.
void test("Initials of the first two words; a single word gives its first two graphemes.", async (t) => {
  // doctest:L26
  t.check(
    [
      abbreviateTitle("Acids Bases Lesson Plan"),
      abbreviateTitle("Sourdough Bread"),
      abbreviateTitle("Bread"),
      abbreviateTitle("weekend errands"),
    ].join(","),
    "AB,SB,BR,WE",
  );

  // Whitespace and empties do not produce junk.

  // doctest:L38
  t.check([abbreviateTitle("   "), abbreviateTitle(""), abbreviateTitle("  Spaced   Out  ")].join("|"), "||SO");

  // An emoji title abbreviates to the emoji itself rather than to half of one —
  // the same grapheme discipline as the glyph cap.

  // doctest:L46
  t.check(abbreviateTitle("🍞 Bread Notes"), "🍞B");
});

// ## Which glyphs are ambiguous
//
// A glyph worn by two pinned tabs no longer says which card it is. One worn once
// does.
void test("A glyph worn by two pinned tabs no longer says which card it is.", async (t) => {
  // doctest:L56
  const pinned = [
    { symbol: { glyph: "🍳" } },
    { symbol: { glyph: "🍳" } },
    { symbol: { glyph: "🍞" } },
    { symbol: null },
  ];
  t.check([...ambiguousMarks(pinned)].join(","), "glyph:🍳");

  // Whole glyphs are compared, not first characters: an author who wrote two
  // different marks meant them to differ.

  // doctest:L70
  await t.checkText([...ambiguousMarks([{ symbol: { glyph: "🍞" } }, { symbol: { glyph: "🍞🥖" } }])].length, "0");
});

// ## The face a pinned tab draws
//
// An unambiguous mark stands alone — this is the browser pinned tab.
void test("An unambiguous mark stands alone — this is the browser pinned tab.", async (t) => {
  // doctest:L79
  const ambiguous = new Set(["glyph:🍳"]);

  // doctest:L81
  t.check(face({ glyph: "🍞" }, { title: "Sourdough Bread", ambiguous }), "🍞|-");

  // An ambiguous one keeps the mark and gains the discriminator, because dropping
  // the mark would be a worse answer than crowding it slightly.

  // doctest:L89
  t.check(face({ glyph: "🍳" }, { title: "Weeknight Chili", ambiguous }), "🍳|WC");

  // A card with no mark shows the abbreviation alone.

  // doctest:L96
  t.check(face(null, { title: "Weekend Errands", ambiguous }), "-|WE");

  // doctest:L99
  t.check(face({ foreground: "#333" }, { title: "Weekend Errands", ambiguous }), "-|WE");

  // An image mark stands alone when it is the only tab wearing that picture — but
  // `src` is only a path, so two cards CAN name the same image, and then it needs
  // the discriminator like any other repeated mark.

  // doctest:L108
  await t.checkText(face({ src: "_content/marks/bread.webp" }, { title: "Sourdough Bread", ambiguous }), "[image]|-");

  // doctest:L111
  await t.checkText(face({ src: "_content/marks/bread.webp" }, { title: "Sourdough Bread", ambiguous: new Set(["src:_content/marks/bread.webp"]) }), "[image]|SB");
});
