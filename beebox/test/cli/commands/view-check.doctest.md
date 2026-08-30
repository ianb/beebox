# Checking all views in a box

`checkViews(boxRoot, { timeoutMs })` renders every view in a box (each in a
killable `bbx view test` child) and reports which fail. It's the whole-box gate a
migration uses (`bbx view check`) and the broken-view detector. `ok` is true only
when every view renders.

```ts setup
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { checkViews } from "../../../src/cli/commands/view.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

// This test verifies render correctness, not the production timeout threshold.
// Full-suite contention has pushed a valid cold render past 40 seconds, so keep
// enough headroom here while the outer doctest timeout still catches hangs.
const TEST_VIEW_TIMEOUT_MS = 60000;

// A v2 box carries its own physical React copy. The renderer overrides it
// with the engine's copy so hook-using views share react-dom/server's
// dispatcher. `makeTmpBox({ deps: true })` therefore simulates the normal
// package layout by placing React beside the symlinked `beebox` package.
async function makeViewBox() {
  const box = await makeTmpBox({ deps: true });
  const reactNodeModules = dirname(dirname(requireFromEngine.resolve("react/package.json")));
  await symlink(join(reactNodeModules, "react"), join(box.packageRoot, "node_modules", "react"), "dir");
  return box;
}

// Views live at the package root (`<packageRoot>/src/views`) for a v2 box.
async function writeView(box, rel, content) {
  const full = join(box.packageRoot, "src", "views", rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

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

```ts
const box = await makeViewBox();
await writeView(box, "good.tsx", GOOD_VIEW);
await writeView(box, "broken.tsx", BROKEN_VIEW);
await box.write("box/inbox/Test.memo.card", MEMO_CARD);

const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
result.ok
=> false

result.views.find((v) => v.slug === "good")?.ok
=> true

result.views.find((v) => v.slug === "broken")?.ok
=> false

(result.views.find((v) => v.slug === "broken")?.error ?? "").length > 0
=> true
```

```ts cleanup
await box.cleanup();
```

## A box with no broken views passes

```ts
const box = await makeViewBox();
await writeView(box, "good.tsx", GOOD_VIEW);

const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
result.ok
=> true

result.views.length
=> 1
```

```ts cleanup
await box.cleanup();
```

## A box with no views at all is trivially OK

```ts
const box = await makeTmpBox();
const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
JSON.stringify(result)
=> {"ok":true,"views":[]}
```

```ts cleanup
await box.cleanup();
```
</content>
