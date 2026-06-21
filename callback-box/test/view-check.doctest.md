# Checking all views in a box

`checkViews(boxRoot, { timeoutMs })` renders every view in a box (each in a
killable `cb view test` child) and reports which fail. It's the whole-box gate a
migration uses (`cb view check`) and the broken-view detector. `ok` is true only
when every view renders.

```ts setup
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { checkViews } from "../src/cli/commands/view.js";

const MEMO_CARD = `---
status: new
created: 2026-03-01T12:00:00Z
---
Test memo content
`;

const GOOD_VIEW = `export const name = "Good";
export const description = "renders fine";
export const dependencies = [];
export const modes = ["page"];
export default function Good() {
  return <div>ok</div>;
}
`;

// Reads card.attrs (removed from ViewCard) — card.attrs is undefined, so
// card.attrs.title throws at render. This is exactly the breakage the
// view-card-shape migration exists to find and fix.
const BROKEN_VIEW = `export const name = "Broken";
export const description = "reads a removed field";
export const dependencies = ["box/**/*.memo.card"];
export const modes = ["page"];
export default function Broken({ cards }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.attrs.title}</li>)}</ul>;
}
`;
```

## A mix of good and broken views fails, and names which

```
const box = await makeTmpBox();
await box.write("views/good.tsx", GOOD_VIEW);
await box.write("views/broken.tsx", BROKEN_VIEW);
await box.write("box/inbox/Test.memo.card", MEMO_CARD);

const result = await checkViews({ boxRoot: box.root, timeoutMs: 20000 });
result.ok
=> false

result.views.find((v) => v.slug === "good")?.ok
=> true

result.views.find((v) => v.slug === "broken")?.ok
=> false

(result.views.find((v) => v.slug === "broken")?.error ?? "").length > 0
=> true
```

``` cleanup
await box.cleanup();
```

## A box with no broken views passes

```
const box = await makeTmpBox();
await box.write("views/good.tsx", GOOD_VIEW);

const result = await checkViews({ boxRoot: box.root, timeoutMs: 20000 });
result.ok
=> true

result.views.length
=> 1
```

``` cleanup
await box.cleanup();
```

## A box with no views at all is trivially OK

```
const box = await makeTmpBox();
const result = await checkViews({ boxRoot: box.root, timeoutMs: 20000 });
JSON.stringify(result)
=> {"ok":true,"views":[]}
```

``` cleanup
await box.cleanup();
```
</content>
