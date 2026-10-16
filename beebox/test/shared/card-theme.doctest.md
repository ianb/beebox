# Card theme selection

Theme choice is data, independent of the renderer. The shared resolver is pure
so the browser and server diagnostics use the same precedence and vocabulary.

```ts setup
import {
  parsePresentationConfig,
  resolveCardTheme,
  resolveChromeTheme,
  systemCardThemes,
  THEME_CATALOG,
  themePatternMatches,
  validateThemePattern,
  validateSystemThemeChoice,
} from "../../src/shared/card-theme/core.js";
import { cardSchema } from "../../src/cards/schema.js";
import { z } from "zod";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { buildLoadContext } from "../../src/core/load-context.js";
import { lintCardsDispatch } from "../../src/core/card-lint/core/lint-cards.js";

function invalidSchemaThrows() {
  try {
    // A malformed choice — a bare string where the field wants
    // `{ name, stock? }`. An unfamiliar NAME is fine; a wrong shape is not.
    // `theme` is typed `{ name, stock? }`; Reflect.apply passes the malformed value to reach the runtime check.
    Reflect.apply(cardSchema, undefined, ["bad-theme-example", {
      fields: { title: z.string() },
      theme: "velvet",
    }]);
    return false;
  } catch (error) {
    return String(error).includes("must be an object");
  }
}
```

The card wins. Without one, the first matching ordered rule wins before the box
type override, schema preference, box default, and engine fallback.

```ts
const presentation = parsePresentationConfig({
  default: { name: "paper", stock: "blue" },
  cardTypes: { memo: { name: "plain" } },
  rules: [
    { match: "_content/notes/**", theme: { name: "post-it", stock: "mint" } },
    { match: "_content/**", theme: { name: "paper" } },
  ],
});

JSON.stringify(resolveCardTheme({
  path: "_content/notes/One.memo.card",
  type: "memo",
  cardChoice: { name: "paper", stock: "manila" },
  typeDefault: { name: "paper" },
  presentation,
}))
=> {"choice":{"name":"paper","stock":"manila"},"problem":null,"origin":{"kind":"card"}}

JSON.stringify(resolveCardTheme({
  path: "_content/notes/One.memo.card",
  type: "memo",
  typeDefault: { name: "paper" },
  presentation,
}))
=> {"choice":{"name":"post-it","stock":"mint"},"problem":null,"origin":{"kind":"rule","index":0}}
```

Choices are atomic: omitting stock takes that theme's default. It cannot inherit
the lower paper stock. With no authored choice, the engine is plain.

```ts
JSON.stringify(resolveCardTheme({
  path: "_content/tasks/One.memo.card",
  type: "memo",
  presentation: parsePresentationConfig({
    default: { name: "paper", stock: "blue" },
    cardTypes: { memo: { name: "post-it" } },
  }),
}))
=> {"choice":{"name":"post-it","stock":"yellow"},"problem":null,"origin":{"kind":"type-override"}}

JSON.stringify(resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  presentation: { status: "absent" },
}))
=> {"choice":{"name":"plain","stock":"neutral"},"origin":{"kind":"engine"},"problem":null}
```

Shown on a system theme, a card with no authored choice takes that system
theme's default card theme. Every authored source still wins over it, the box
default included. An unknown system theme falls back to plain.

```ts
JSON.stringify(resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  presentation: { status: "absent" },
  systemTheme: "candy",
}))
=> {"choice":{"name":"letter-set","stock":"strawberry"},"problem":null,"origin":{"kind":"system","theme":"candy"}}

JSON.stringify(resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  presentation: parsePresentationConfig({ default: { name: "post-it" } }),
  systemTheme: "candy",
}).origin.kind)
=> "box-default"

JSON.stringify(resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  presentation: { status: "absent" },
  systemTheme: "a-box-authored-theme",
}).choice.name)
=> "plain"

systemCardThemes("paper")
=> ["paper","post-it","letter-set"]
```

Each system theme's default card theme is a card theme, and every theme it
pairs with exists in the catalog.

```ts
THEME_CATALOG.filter((theme) => theme.chrome).flatMap((theme) => systemCardThemes(theme.name)
  .filter((name) => THEME_CATALOG.find((item) => item.name === name)?.systemOnly !== false)
  .map((name) => `${theme.name}: ${name}`))
=> []
```

Themes are an OPEN set. A stock the catalog does not list is the author's
choice, not an error: it is carried through as written, and the card's own
choice still wins over the presentation default. The catalog supplies defaults
and capabilities for the themes the host ships; it is not an allowlist.

```ts
const ownStock = resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  cardChoice: { name: "paper", stock: "neon" },
  presentation: parsePresentationConfig({ default: { name: "post-it" } }),
});
JSON.stringify([ownStock.choice, ownStock.origin, ownStock.problem])
=> [{"name":"paper","stock":"neon"},{"kind":"card"},null]
```

A theme name the host has never heard of is equally fine — a box may author its
own. With no catalog entry there is no default stock, so it gets the neutral
one unless the card names its own.

```ts
const ownTheme = resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  cardChoice: { name: "velvet" },
  presentation: { status: "absent" },
});
JSON.stringify([ownTheme.choice, ownTheme.problem])
=> [{"name":"velvet","stock":"neutral"},null]
```

Presentation config is one validated unit. What still makes it invalid is a
malformed *shape* — a bad match pattern here — not an unfamiliar theme name.

```ts
const badConfig = parsePresentationConfig({
  default: { name: "unknown" },
  rules: [{ match: "/absolute/**", theme: { name: "paper" } }],
});
JSON.stringify([badConfig.status, badConfig.status === "invalid" ? badConfig.problems.length : 0])
=> ["invalid",1]

const degraded = resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  presentation: badConfig,
});
JSON.stringify([degraded.choice, degraded.origin, degraded.problem?.location])
=> [{"name":"plain","stock":"neutral"},{"kind":"engine"},"presentation"]
```

`**` crosses zero or more segments while `*` stays within one segment.

```ts
JSON.stringify([
  themePatternMatches("_content/**/Notes.*.card", "_content/Notes.memo.card"),
  themePatternMatches("_content/**/Notes.*.card", "_content/archive/Notes.memo.card"),
  themePatternMatches("_content/*/Notes.*.card", "_content/archive/deep/Notes.memo.card"),
  validateThemePattern("_content/foo**bar"),
  validateThemePattern("../outside/**"),
])
=> [true,true,false,"** must occupy a complete path segment","pattern must not contain . or .. path segments"]
```

Chrome is selected independently. A theme without a chrome implementation is
a visible configuration problem with base/plain fallback.

```ts
const chrome = resolveChromeTheme(parsePresentationConfig({ chrome: { name: "post-it" } }));
JSON.stringify([chrome.choice, chrome.origin, chrome.problem?.message])
=> [{"name":"plain","stock":"neutral"},"box-chrome","Theme \"post-it\" does not provide app chrome"]
```

A saved system theme the host does not ship — box-authored, or one a later
release removed — keeps the box usable: chrome falls back to Flat and the
choice is reported as a problem rather than silently rewritten.

```ts
const retired = resolveChromeTheme(parsePresentationConfig({ chrome: { name: "retired-theme", stock: "retired-stock" } }));
JSON.stringify([retired.choice, retired.origin, retired.problem?.message, validateSystemThemeChoice({ name: "retired-theme" }).choice])
=> [{"name":"plain","stock":"neutral"},"box-chrome","Theme \"retired-theme\" does not provide app chrome",{"name":"plain","stock":"neutral"}]
```

A card saved with such a theme keeps its literal name and stock with no
problem; it renders on the base card material until a person chooses another.

```ts
const retiredCard = resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  cardChoice: { name: "retired-theme", stock: "retired-stock" },
  presentation: { status: "absent" },
  systemTheme: "paper",
});
JSON.stringify([retiredCard.choice, retiredCard.origin, retiredCard.problem])
=> [{"name":"retired-theme","stock":"retired-stock"},{"kind":"card"},null]
```

Choosing chrome does not recolor the card's saved theme. A card can choose a
sticky note over the box's Paper default while chrome stays Spectrum; no stock
leaks from either of the other choices.

```ts
const mixed = parsePresentationConfig({
  default: { name: "paper" },
  chrome: { name: "spectrum" },
});
const mixedCard = resolveCardTheme({
  path: "_content/One.memo.card",
  type: "memo",
  cardChoice: { name: "post-it" },
  presentation: mixed,
});
const mixedChrome = resolveChromeTheme(mixed);
[mixedCard, mixedChrome]
=> [
  { choice: { name: "post-it", stock: "yellow" }, problem: null, origin: { kind: "card" } },
  { choice: { name: "spectrum", stock: "gradient" }, problem: null, origin: "box-chrome" },
]
```

A card-only box default does not require its theme to provide chrome. When the
default is a sticky note, app chrome quietly keeps the engine's plain theme:

```ts
const implicitChrome = resolveChromeTheme(parsePresentationConfig({ default: { name: "post-it" } }));
JSON.stringify(implicitChrome)
=> {"choice":{"name":"plain","stock":"neutral"},"origin":"engine","problem":null}
```

The global field validates the persisted selector's shape, and a schema can
carry a catalog-validated default as metadata.

```ts
const schema = cardSchema("theme-example", {
  fields: { body: z.string() },
  theme: { name: "paper", stock: "cream" },
});
JSON.stringify([schema.defaultTheme, schema.frontmatterSchema.safeParse({
  type: "theme-example",
  body: "ignored",
  theme: { name: "post-it", stock: "rose" },
}).success])
=> [{"name":"paper","stock":"cream"},true]
```

An engine schema may publish any theme name; only a malformed choice throws.

```ts
invalidSchemaThrows()
=> true
```

Card lint accepts a stock the catalog does not list — the box may have authored
it — and still rejects a malformed `theme:` field, which is a shape error no
open value can excuse.

```ts
const lintBox = await makeTmpBox();
await lintBox.write(
  "_content/Own.memo.card",
  "---\ncreated: 2026-09-07T12:00:00Z\ntheme:\n  name: paper\n  stock: purple\n---\nBody\n",
);
await lintBox.write(
  "_content/Bad.memo.card",
  "---\ncreated: 2026-09-07T12:00:00Z\ntheme: paper\n---\nBody\n",
);
const lintResult = await lintCardsDispatch(
  [lintBox.path("_content/Own.memo.card"), lintBox.path("_content/Bad.memo.card")],
  { boxRoot: lintBox.root, ctx: await buildLoadContext(lintBox.root) },
);
JSON.stringify([
  lintResult.totalErrors,
  lintResult.results.flatMap((r) => r.errors).some((e) => e.message.includes("theme: expected object, got string")),
])
=> [1,true]
```

```ts cleanup
await lintBox.cleanup();
```

Bloom is both a system and card material. Choosing it supplies the approved
cutouts stock to unthemed cards; an explicit Paper card keeps its own material.

```ts
validateSystemThemeChoice({ name: "bloom" })
=> { choice: { name: "bloom", stock: "cutouts" }, problem: null }

systemCardThemes("bloom")
=> ["bloom", "letter-set", "post-it"]

resolveCardTheme({ path: "_content/Seed.memo.card", type: "memo", presentation: { status: "absent" }, systemTheme: "bloom" })
=> { choice: { name: "bloom", stock: "cutouts" }, problem: null, origin: { kind: "system", theme: "bloom" } }

resolveCardTheme({ path: "_content/Seed.memo.card", type: "memo", presentation: { status: "absent" }, systemTheme: "bloom", cardChoice: { name: "paper", stock: "blue" } }).choice
=> { name: "paper", stock: "blue" }
```

Ribbon supplies the flow stock to unthemed cards while retaining explicit choices.
Its paired card list puts its own material first.

```ts
validateSystemThemeChoice({ name: "ribbon" })
=> { choice: { name: "ribbon", stock: "flow" }, problem: null }

systemCardThemes("ribbon")
=> ["ribbon", "paper", "post-it"]

resolveCardTheme({ path: "_content/Seed.memo.card", type: "memo", presentation: { status: "absent" }, systemTheme: "ribbon" })
=> { choice: { name: "ribbon", stock: "flow" }, problem: null, origin: { kind: "system", theme: "ribbon" } }

resolveCardTheme({ path: "_content/Seed.memo.card", type: "memo", presentation: { status: "absent" }, systemTheme: "ribbon", cardChoice: { name: "paper", stock: "blue" } }).choice
=> { name: "paper", stock: "blue" }
```
