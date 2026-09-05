# `bbx validate`'s box-wide error buckets

`checkRootStrayErrors` (Track C, `docs/implemented-plans/one-root-box-layout.md`) formats
`checkBoxRoot`'s findings as the error lines `bbx validate` prints and counts
toward its exit code. The check itself (`checkBoxRoot`) is doctested in
`test/lib/box-root-check.doctest.md`; this covers only the formatting.

```ts setup
import { checkRootStrayErrors } from "../../../src/cli/commands/validate-box-checks.js";
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
