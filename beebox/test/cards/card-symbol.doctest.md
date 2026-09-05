# A card's symbol (`cards/symbol.ts`, `shared/css-colour.ts`, `shared/graphemes.ts`)

Every card may carry a `symbol` — the small mark that stands for it in a tab
strip, a listing, or a tile. It is a global field, so no schema declares it, and
one grouped key rather than several flat ones: `glyph` and `src` are the two
ways to be a mark, and they sit side by side so an author choosing between them
sees both.

```ts setup
import { GLOBAL_CARD_FIELDS } from "../../src/cards/schema.js";
import { CardSymbol, MAX_GLYPH_GRAPHEMES } from "../../src/cards/symbol.js";
import { isCssColour } from "../../src/shared/css-colour.js";
import { countGraphemes } from "../../src/shared/graphemes.js";
```

## It is a global field

```ts
Object.keys(GLOBAL_CARD_FIELDS).join(",")
=> title,contains,contains-evidence,todos,symbol

GLOBAL_CARD_FIELDS["symbol"].isOptional()
=> true
```

## The group parses, and every key is optional

```ts
JSON.stringify(CardSymbol.parse({ glyph: "🍞", background: "hsl(35 60% 88%)" }))
=> {"glyph":"🍞","background":"hsl(35 60% 88%)"}

JSON.stringify(CardSymbol.parse({ src: "/_content/marks/bread.webp" }))
=> {"src":"/_content/marks/bread.webp"}

JSON.stringify(CardSymbol.parse({}))
=> {}
```

A non-string value in a key is a parse failure, like any other mistyped field —
the lenient handling is for a *string* that is not a colour, not for a number
where a string belongs.

```ts continue
CardSymbol.safeParse({ background: 3 }).success
=> false
```

## Graphemes, not code points, decide whether a glyph is short

This is the whole reason `countGraphemes` exists. A single emoji is routinely
several code points, so `.length` would reject marks that are obviously one
mark — and a two-letter abbreviation, which an author may deliberately ask for,
is two.

```ts
const family = "👨‍👩‍👧‍👦";
const scotland = "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
const kiss = "👨🏻‍❤️‍💋‍👨🏽";

[family.length, scotland.length, kiss.length].join(",")
=> 11,14,15

[countGraphemes(family), countGraphemes(scotland), countGraphemes(kiss)].join(",")
=> 1,1,1

[countGraphemes("AB"), countGraphemes("recipe"), countGraphemes("")].join(",")
=> 2,6,0
```

Every one of those emoji is well inside the cap, which is what a code-point cap
of the same size would have got wrong: the kiss alone is ten code points.

```ts continue
[countGraphemes(kiss) <= MAX_GLYPH_GRAPHEMES, [...kiss].length <= MAX_GLYPH_GRAPHEMES].join(",")
=> true,false
```

## Colours: six forms, and nothing else

```ts
["#3a7", "#33aa77", "hsl(210 40% 50%)", "hsla(210, 40%, 50%, .5)", "rgb(1 2 3)", "rgba(1, 2, 3, .5)"]
  .every(isCssColour)
=> true
```

Named colours and modern syntaxes are refused on purpose: the only complete
validator is `CSS.supports()`, which does not exist in Node, so a small
vocabulary is the honest one. A nested function cannot sneak through, because
parentheses are not in the accepted character set.

```ts continue
["rebeccapurple", "color-mix(in srgb, red, blue)", "oklch(70% 0.1 200)", "#3a7f", "", "  ",
 "javascript:alert(1)", "rgb(url(evil))", "hsl(210 40% 50%); background: red"].some(isCssColour)
=> false
```

Whitespace around a value is tolerated — a hand-authored card should not fail on
a trailing space.

```ts continue
isCssColour("  #3a7  ")
=> true
```
