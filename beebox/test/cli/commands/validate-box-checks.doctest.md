# `bbx validate`'s box-wide error buckets

`checkRootStrayErrors` (Track C, `docs/implemented-plans/one-root-box-layout.md`) formats
`checkBoxRoot`'s findings as the error lines `bbx validate` prints and counts
toward its exit code. The check itself (`checkBoxRoot`) is doctested in
`test/lib/box-root-check.doctest.md`; this covers only the formatting.

```ts setup
import {
  checkPresentationErrors,
  checkReservedSegmentErrors,
  checkRootStrayErrors,
} from "../../../src/cli/commands/validate-box-checks.js";
import { clearBoxConfigCache } from "../../../src/core/box/config.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

A clean box reports nothing:

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/x.memo.card", "---\nstatus: new\n---\n");
JSON.stringify(await checkRootStrayErrors(box.root))
=> []
```

```ts cleanup
await box.cleanup();
```

A stray root entry becomes one `Box root: …` error line, ready to print
alongside the other buckets `bbx validate` reports:

```ts
const strayBox = await makeTmpBox();
await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
(await checkRootStrayErrors(strayBox.root)).join("\n")
=> Box root: recipes: the box root is a closed vocabulary — user content goes under /_content/
```

```ts cleanup
await strayBox.cleanup();
```

## Below-root reserved area names

`checkReservedSegmentErrors` walks every underscore area except `_tmp` and
reports entries nesting a reserved area name (`box-reserved-segments.ts`) —
the net for out-of-band writes (a plain `mkdir` from an agent shell) that the
CLI/HTTP guards never saw. The shallowest offender is reported once, not
every file inside it:

```ts
const nestedBox = await makeTmpBox();
await nestedBox.write("_content/recipes/_config/x.md", "stray\n");
(await checkReservedSegmentErrors(nestedBox.root)).join("\n")
=> Reserved name: _content/recipes/_config: "_config" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry
```

The template-updates mirror stays clean:

```ts continue
await nestedBox.write("_config/_template-updates/_content/briefing.md", "parked\n");
JSON.stringify((await checkReservedSegmentErrors(nestedBox.root)).length)
=> 1
```

```ts cleanup
await nestedBox.cleanup();
```

`_tmp` is walked too (nesting the NAME `_tmp` is legal; a `_config` hiding in
scratch is not), and a descendant of an offender — even one itself named
`_config` — is not re-reported:

```ts
const tmpBox = await makeTmpBox();
await tmpBox.write("_tmp/_config/x.txt", "stray\n");
await tmpBox.write("_content/_config/_config/y.txt", "stray\n");
(await checkReservedSegmentErrors(tmpBox.root)).join("\n")
=> Reserved name: _content/_config: "_config" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry
Reserved name: _tmp/_config: "_config" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry
```

```ts cleanup
await tmpBox.cleanup();
```

## Card-theme presentation configuration

The box-wide validator checks `_config/box.json`'s presentation block against
the deliberately small path-pattern language. It does NOT check theme names or
stocks against a catalog — those are an open set, so an unrecognized stock is
the box's own vocabulary and falls back at the renderer:

```ts
const themeBox = await makeTmpBox();
await themeBox.write("_config/box.json", JSON.stringify({
  presentation: {
    default: { name: "paper", stock: "cream" },
    rules: [{ match: "_content/**", theme: { name: "post-it", stock: "yellow" } }],
  },
}));
JSON.stringify(await checkPresentationErrors(themeBox.root))
=> []

await themeBox.write("_config/box.json", JSON.stringify({
  presentation: {
    rules: [{ match: "../outside/**", theme: { name: "post-it", stock: "purple" } }],
  },
}));
clearBoxConfigCache(themeBox.root);
(await checkPresentationErrors(themeBox.root)).join("\n")
=> Presentation: presentation.rules.0.match: pattern must not contain . or .. path segments
```

```ts cleanup
await themeBox.cleanup();
```
