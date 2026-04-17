# Loader Registry

Produces `FileSummary` values for files, dispatched by tagName or path pattern.

```ts setup
import {
  registerTagLoader,
  registerPathLoader,
  resetLoaderRegistry,
  summarize,
} from "../src/core/loader-registry.js";
import type { FileLoader } from "../src/core/file-summary.js";
import { emptyLocation, type ElementNode } from "cardworks";

function makeElement(tagName: string, attrs: Record<string, string>, text?: string): ElementNode {
  return {
    tagName,
    attrs,
    children: [],
    text,
    comments: {},
    location: emptyLocation(),
    dirty: false,
  } as ElementNode;
}
```

## Fallback strips extensions and underscores

No registration needed — fallback handles everything.

```
resetLoaderRegistry();
const s = summarize({ path: "box/inbox/Meeting_Notes.memo.card" });
s.title
=> Meeting Notes
```

```
resetLoaderRegistry();
const s = summarize({ path: "photo-001.jpg" });
s.title
=> photo 001
```

## tagName loader wins over path match

```
resetLoaderRegistry();
registerPathLoader<{ size: "large" }>(
  (p: string) => p.endsWith(".card"),
  (raw) => ({ path: raw.path, title: "path-matched", attrs: { size: "large" } }),
);
registerTagLoader<{ status: string }>("memo", (raw) => ({
  path: raw.path,
  tagName: "memo",
  title: "tag-matched",
  attrs: { status: String(raw.element!.attrs["status"] ?? "unknown") },
}));
const el = makeElement("memo", { status: "new" });
const s = summarize({ path: "box/inbox/foo.memo.card", element: el });
s.title
=> tag-matched

JSON.stringify(s.attrs)
=> {"status":"new"}
```

## Path match fires when no tagName registered

```
resetLoaderRegistry();
registerPathLoader<Record<string, never>>(
  (p: string) => p.endsWith(".md"),
  (raw) => ({ path: raw.path, title: `md:${raw.path}`, attrs: {} }),
);
const s = summarize({ path: "store/notes/todo.md" });
s.title
=> md:store/notes/todo.md
```

## tagName collision is last-wins with a warning

```
resetLoaderRegistry();
const warnings: string[] = [];
const original = console.warn;
console.warn = (msg: string) => { warnings.push(msg); };
const first: FileLoader<Record<string, never>> = (raw) => ({ path: raw.path, title: "first", attrs: {} });
const second: FileLoader<Record<string, never>> = (raw) => ({ path: raw.path, title: "second", attrs: {} });
registerTagLoader("memo", first);
registerTagLoader("memo", second);
console.warn = original;
warnings.length
=> 1
```

``` continue
const el = makeElement("memo", {});
summarize({ path: "a.memo.card", element: el }).title
=> second
```
