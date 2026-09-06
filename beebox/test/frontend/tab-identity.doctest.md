# What a pinned sidecar tab shows (`tab-identity.ts`)

A pinned tab is compact, so it shows one thing: its mark when that mark says
which card it is, an abbreviation when it doesn't. The rule the boxholder asked
for is browser-pinned-tab behaviour plus a discriminator — and the discriminator
is why ambiguity has to be defined carefully.

```ts setup
import { abbreviateTitle, ambiguousMarks, pinnedFace } from "../../src/frontend/src/components/chat/tab-identity.js";

/** A pinned tab's face as "mark|abbreviation", with "-" for an absent half. */
function face(symbol: unknown, title: string, ambiguous: ReadonlySet<string>): string {
  const f = pinnedFace({ symbol: symbol as never, title, ambiguous });
  const mark = f.mark?.glyph ?? (f.mark?.src === undefined ? "-" : "[image]");
  return `${mark}|${f.abbreviation ?? "-"}`;
}
```

## Abbreviating a title

Initials of the first two words; a single word gives its first two graphemes.
Both uppercased, so a strip of abbreviations reads as marks rather than as
truncated prose.

```ts
[
  abbreviateTitle("Acids Bases Lesson Plan"),
  abbreviateTitle("Sourdough Bread"),
  abbreviateTitle("Bread"),
  abbreviateTitle("weekend errands"),
].join(",")
=> AB,SB,BR,WE
```

Whitespace and empties do not produce junk.

```ts continue
[abbreviateTitle("   "), abbreviateTitle(""), abbreviateTitle("  Spaced   Out  ")].join("|")
=> ||SO
```

An emoji title abbreviates to the emoji itself rather than to half of one —
the same grapheme discipline as the glyph cap.

```ts continue
abbreviateTitle("🍞 Bread Notes")
=> 🍞B
```

## Which glyphs are ambiguous

A glyph worn by two pinned tabs no longer says which card it is. One worn once
does.

```ts
const pinned = [
  { symbol: { glyph: "🍳" } },
  { symbol: { glyph: "🍳" } },
  { symbol: { glyph: "🍞" } },
  { symbol: null },
];
[...ambiguousMarks(pinned)].join(",")
=> glyph:🍳
```

Whole glyphs are compared, not first characters: an author who wrote two
different marks meant them to differ.

```ts continue
[...ambiguousMarks([{ symbol: { glyph: "🍞" } }, { symbol: { glyph: "🍞🥖" } }])].length
=> 0
```

## The face a pinned tab draws

An unambiguous mark stands alone — this is the browser pinned tab.

```ts
const ambiguous = new Set(["glyph:🍳"]);

face({ glyph: "🍞" }, "Sourdough Bread", ambiguous)
=> 🍞|-
```

An ambiguous one keeps the mark and gains the discriminator, because dropping
the mark would be a worse answer than crowding it slightly.

```ts continue
face({ glyph: "🍳" }, "Weeknight Chili", ambiguous)
=> 🍳|WC
```

A card with no mark shows the abbreviation alone.

```ts continue
face(null, "Weekend Errands", ambiguous)
=> -|WE

face({ foreground: "#333" }, "Weekend Errands", ambiguous)
=> -|WE
```

An image mark stands alone when it is the only tab wearing that picture — but
`src` is only a path, so two cards CAN name the same image, and then it needs
the discriminator like any other repeated mark.

```ts continue
face({ src: "_content/marks/bread.webp" }, "Sourdough Bread", ambiguous)
=> [image]|-

face({ src: "_content/marks/bread.webp" }, "Sourdough Bread", new Set(["src:_content/marks/bread.webp"]))
=> [image]|SB
```

## The ambiguity set is the pinned tabs, not every open tab

Nothing here reads the unpinned tabs, which is the point: a pinned card's face
must not change because someone opened an unrelated document that happens to
wear the same emoji.

```ts
const pinnedOnly = [{ symbol: { glyph: "🍳" } }];
[...ambiguousMarks(pinnedOnly)].length
=> 0

face({ glyph: "🍳" }, "Recipes", ambiguousMarks(pinnedOnly))
=> 🍳|-
```
