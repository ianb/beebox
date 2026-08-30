# Twemoji artwork lookup

`twemojiSvgPath` (`lib/twemoji.ts`) turns a box's emoji symbol into the path of
Twemoji's SVG for it. The artwork is pure shapes, so rasterizing it needs no
font on the server and comes out in colour — which rendering the character as
text does not.

```ts setup
import { twemojiCodePoints, twemojiSvgPath } from "../../src/lib/twemoji.js";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const fileFor = (emoji: string) => {
  const p = twemojiSvgPath(emoji);
  return p === null ? "(none)" : `${basename(p)} ${existsSync(p) ? "exists" : "MISSING"}`;
};
```

## A plain emoji resolves to its codepoint

```ts
[fileFor("📦"), fileFor("🍳")].join(" | ")
=> 1f4e6.svg exists | 1f373.svg exists
```

## The variation selector is dropped, except in a ZWJ sequence

`⚗️` is U+2697 followed by U+FE0F, but Twemoji names the file `2697.svg`. In a
ZWJ sequence the selector is part of how the sequence is spelled, so it stays —
getting this backwards resolves to a file that isn't there.

```ts
[twemojiCodePoints("⚗️"), fileFor("⚗️")].join(" | ")
=> 2697 | 2697.svg exists
```

```ts continue
fileFor("👩‍🍳")
=> 1f469-200d-1f373.svg exists
```

Twemoji's own filenames disagree with each other about this: the rainbow flag
keeps its VS16 while the cook drops it. So both spellings are tried, and an
emoji typed with the selector its file omits still resolves rather than
silently falling back to the generic icon.

```ts continue
[fileFor("🏳️‍🌈"), fileFor("👩‍🍳".replace("\u{1f469}", "\u{1f469}\uFE0F"))].join(" | ")
=> 1f3f3-fe0f-200d-1f308.svg exists | 1f469-200d-1f373.svg exists
```

## Symbols with no artwork answer null, and that is ordinary

A symbol is free text from a card — it can be a letter, a word, or an emoji
newer than the bundled set. Callers fall back to the app's own icon.

```ts
JSON.stringify([
  twemojiSvgPath(""),
  twemojiSvgPath("   "),
  twemojiSvgPath("Kitchen"),
])
=> [null,null,null]
```

A single letter is a legal codepoint sequence but no emoji, so it answers null
like anything else without artwork.

```ts continue
fileFor("A")
=> (none)
```

## A symbol cannot escape the asset directory

Every character becomes hex digits, so a symbol that looks like a path is just
a name no artwork answers to — containment is a property of the encoding, not
a check that could be forgotten.

```ts
JSON.stringify([
  twemojiCodePoints("../x"),
  twemojiSvgPath("../../etc/passwd"),
  twemojiSvgPath("/etc/passwd"),
])
=> ["2e-2e-2f-78",null,null]
```
