# Closed-vocabulary root check

`checkBoxRoot` (`src/lib/box-root-check.ts`) readdirs a box root and reports
every entry outside `BOX_ROOT_VOCABULARY` — the check that turns a recreated
two-root shape into one loud `bbx validate` (Track C,
`docs/plans/one-root-box-layout.md`).

```ts setup
import { checkBoxRoot } from "../../src/lib/box-root-check.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

A box with only vocabulary entries — areas, npm namespace, agent identity —
reports nothing:

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/x.memo.card", "---\nstatus: new\n---\n");
await box.write("package.json", "{}");
await box.write("CLAUDE.md", "# Box\n");
JSON.stringify(await checkBoxRoot(box.root))
=> []
```

```ts cleanup
await box.cleanup();
```

A stray non-underscore directory — the "user content lives loose at the root"
mistake — is reported as a closed-vocabulary violation:

```ts
const strayBox = await makeTmpBox();
await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
const strays = await checkBoxRoot(strayBox.root);
JSON.stringify(strays.map((s) => ({ name: s.name, kind: s.kind })))
=> [{"name":"recipes","kind":"unlisted"}]

strays[0]!.message
=> recipes: the box root is a closed vocabulary — user content goes under /_content/
```

```ts cleanup
await strayBox.cleanup();
```

A stray `content/` directory gets a message calling out the specific
recreated-two-root failure mode this check exists to catch:

```ts
const legacyBox = await makeTmpBox();
await legacyBox.write("content/box/inbox/x.memo.card", "---\nstatus: new\n---\n");
const legacyStrays = await checkBoxRoot(legacyBox.root);
legacyStrays[0]!.message
=> content: the box root is a closed vocabulary — user content goes under /_content/ (this is the pre-migration operational-root name — a v2 leftover, not a place to write to)
```

```ts cleanup
await legacyBox.cleanup();
```

An unlisted underscore directory — an ad hoc `_scratch`, say — gets its own,
more specific message: the underscore areas are a closed FIVE, not an open
convention:

```ts
const adHocBox = await makeTmpBox();
await adHocBox.write("_scratch/notes.txt", "hi");
const adHocStrays = await checkBoxRoot(adHocBox.root);
JSON.stringify(adHocStrays.map((s) => ({ name: s.name, kind: s.kind })))
=> [{"name":"_scratch","kind":"ad-hoc-underscore"}]

adHocStrays[0]!.message
=> _scratch: ad hoc underscore directories are reserved — the underscore areas are exactly _content, _config, _bookkeeping, _publish, _tmp; rename or remove this one
```

```ts cleanup
await adHocBox.cleanup();
```

OS/editor junk (`.DS_Store` and friends) is ignored outright, not reported —
and multiple strays all come back, sorted:

```ts
const junkBox = await makeTmpBox();
await junkBox.write(".DS_Store", "");
await junkBox.write("zebra/x.txt", "z");
await junkBox.write("_ad_hoc/x.txt", "a");
const junkStrays = await checkBoxRoot(junkBox.root);
junkStrays.map((s) => s.name).join(",")
=> _ad_hoc,zebra
```

```ts cleanup
await junkBox.cleanup();
```

A box root that doesn't exist yet reports no strays — there is nothing to
flag, and the caller's own box-root resolution is a separate failure mode:

```ts
JSON.stringify(await checkBoxRoot("/nonexistent/not-a-real-box-root-12345"))
=> []
```
