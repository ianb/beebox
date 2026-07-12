# Type-checking views against ViewProps

`typecheckViews(boxRoot)` statically checks each view's default export against the
real `ViewProps`/`ViewCard` — catching removed/renamed field use that compiles
and renders fine but is silently wrong (e.g. `c.tagName` after the card-shape
cleanup), which the render gate (`cb view check`) can't see.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { typecheckViews } from "../../../src/cli/commands/view-typecheck.js";

// Views live at the package root (`<packageRoot>/src/views`) for a v2 box.
async function writeView(box, rel, content) {
  const full = join(box.packageRoot, "src", "views", rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

const HEAD = `export const name = "x";
export const description = "x";
export const dependencies = [];
export const modes = ["page"];
`;

// Stale local type declaring a removed field (the todos.tsx-before-migration
// shape): the real ViewCard has no `tagName`, so the export can't satisfy
// ComponentType<ViewProps>.
const STALE = HEAD + `type VC = { path: string; tagName: string };
export default function V({ cards }: { cards: VC[] }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.tagName}</li>)}</ul>;
}
`;

// Migrated: reads the real fields (path, type).
const CLEAN = HEAD + `type VC = { path: string; type: string };
export default function V({ cards }: { cards: VC[] }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.type}</li>)}</ul>;
}
`;

// `as any` defeats the type system — documented limitation (render/textual
// gates backstop these).
const ANYCAST = HEAD + `export default function V({ cards }: { cards: any[] }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.tagName}</li>)}</ul>;
}
`;

// An internal type error unrelated to ViewCard (the Float32Array-lib-noise
// class) must NOT be flagged — typecheck scopes to the ViewProps boundary, not
// the whole view body.
const NOISE = HEAD + `type VC = { path: string; type: string };
export default function V({ cards }: { cards: VC[] }) {
  const n: number = "not a number";
  return <ul>{cards.map((c) => <li key={c.path}>{c.type}{n}</li>)}</ul>;
}
`;
```

## A stale-typed view (removed field) fails; clean passes; `as any` slips through

```ts
const box = await makeTmpBox({ deps: true });
await writeView(box, "stale.tsx", STALE);
await writeView(box, "clean.tsx", CLEAN);
await writeView(box, "anycast.tsx", ANYCAST);
await writeView(box, "noise.tsx", NOISE);

const result = await typecheckViews(box.root);
result.ok
=> false

result.views.find((v) => v.slug === "stale")?.ok
=> false

(result.views.find((v) => v.slug === "stale")?.errors ?? []).length > 0
=> true

result.views.find((v) => v.slug === "clean")?.ok
=> true

result.views.find((v) => v.slug === "anycast")?.ok
=> true

result.views.find((v) => v.slug === "noise")?.ok
=> true
```

```ts cleanup
await box.cleanup();
```
</content>
