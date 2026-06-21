# Type-checking views against ViewProps

`typecheckViews(boxRoot)` statically checks each view's default export against the
real `ViewProps`/`ViewCard` — catching removed/renamed field use that compiles
and renders fine but is silently wrong (e.g. `c.tagName` after the card-shape
cleanup), which the render gate (`cb view check`) can't see.

```ts setup
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { typecheckViews } from "../src/cli/commands/view-typecheck.js";

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
```

## A stale-typed view (removed field) fails; clean passes; `as any` slips through

```
const box = await makeTmpBox();
await box.write("views/stale.tsx", STALE);
await box.write("views/clean.tsx", CLEAN);
await box.write("views/anycast.tsx", ANYCAST);

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
```

``` cleanup
await box.cleanup();
```
</content>
