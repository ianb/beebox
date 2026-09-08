# Loader Registry

Produces `FileSummary` values for files, dispatched by card type or path pattern.

```ts setup
import {
  registerTypeLoader,
  registerPathLoader,
  resetLoaderRegistry,
  summarize,
} from "../../src/core/loader-registry.js";
import type { FileLoader } from "../../src/core/file-summary.js";
```

## Fallback strips extensions and underscores

No registration needed — fallback handles everything.

```ts
resetLoaderRegistry();
const s = summarize({ path: "_content/inbox/Meeting_Notes.memo.card" });
s.title
=> Meeting Notes
```

```ts
resetLoaderRegistry();
const s = summarize({ path: "photo-001.jpg" });
s.title
=> photo 001
```

## type loader wins over path match

```ts
resetLoaderRegistry();
registerPathLoader<{ size: "large" }>(
  (p: string) => p.endsWith(".card"),
  (raw) => ({ path: raw.path, title: "path-matched", attrs: { size: "large" } }),
);
registerTypeLoader<{ status: string }>("memo", (raw) => ({
  path: raw.path,
  type: "memo",
  title: "tag-matched",
  attrs: { status: String(raw.fields === undefined ? "unknown" : raw.fields["status"] ?? "unknown") },
}));
const s = summarize({ path: "_content/inbox/foo.memo.card", type: "memo", fields: { status: "new" } });
s.title
=> tag-matched

JSON.stringify(s.attrs)
=> {"status":"new"}
```

## Path match fires when no type registered

```ts
resetLoaderRegistry();
registerPathLoader<Record<string, never>>(
  (p: string) => p.endsWith(".md"),
  (raw) => ({ path: raw.path, title: `md:${raw.path}`, attrs: {} }),
);
const s = summarize({ path: "store/notes/todo.md" });
s.title
=> md:store/notes/todo.md
```

## type collision is last-wins with a warning

```ts
resetLoaderRegistry();
const warnings: string[] = [];
const original = console.warn;
console.warn = (msg: string) => { warnings.push(msg); };
const first: FileLoader<Record<string, never>> = (raw) => ({ path: raw.path, title: "first", attrs: {} });
const second: FileLoader<Record<string, never>> = (raw) => ({ path: raw.path, title: "second", attrs: {} });
registerTypeLoader("memo", first);
registerTypeLoader("memo", second);
console.warn = original;
warnings.length
=> 1
```

```ts continue
summarize({ path: "a.memo.card", type: "memo" }).title
=> second
```

## Global card fields are surfaced without teaching every loader about them

`title`, `contains` and `symbol` belong to every card, so `summarize` reads them
rather than each loader remembering to.

```ts
resetLoaderRegistry();
const s = summarize({
  path: "_content/figures/Cube.figure.card",
  type: "figure",
  fields: { title: "Rotating Cube Demo", contains: "A spinning cube.", symbol: { glyph: "🧊" }, theme: { name: "paper", stock: "blue" } },
});
[s.type, s.title, s.contains, s.symbol?.glyph, s.cardTheme?.name, s.cardTheme?.stock].join("|")
=> figure|Rotating Cube Demo|A spinning cube.|🧊|paper|blue
```

An authored theme remains present even when its selection is invalid; the plain
result lets the shared resolver preserve the
explicit-choice precedence over box and schema defaults.

```ts continue
const invalidTheme = summarize({ path: "_content/x.doc.card", type: "doc", fields: { theme: { name: "velvet" } } });
JSON.stringify([invalidTheme.type, invalidTheme.cardTheme])
=> ["doc",{"name":"plain","stock":"neutral"}]

const malformedTheme = summarize({ path: "_content/y.doc.card", type: "doc", fields: { theme: "paper" } });
JSON.stringify(malformedTheme.cardTheme)
=> {"name":"plain","stock":"neutral"}

const raw = summarize({ path: "_content/x.txt" });
JSON.stringify([raw.type, raw.cardTheme])
=> [null,null]
```

A card's own `title:` beats the filename — that is the whole point, and it is
what makes a retitled card retitle its tab.

```ts continue
summarize({ path: "_content/notes/Old_Name.doc.card", type: "doc", fields: { title: "New Name" } }).title
=> New Name
```

But it never beats a title the loader computed on purpose. A memo's title IS
its text, and a loader that made a real choice keeps it; the test is that the
loader's title differs from what the filename alone would give.

```ts continue
registerTypeLoader("memo", (raw) => ({ path: raw.path, title: "the memo's own text", attrs: {} }));
summarize({ path: "_content/inbox/Note.memo.card", type: "memo", fields: { title: "Ignored" } }).title
=> the memo's own text
```

A malformed symbol is dropped rather than shipped — `readCardSymbol` validates
before it resolves.

```ts continue
resetLoaderRegistry();
summarize({ path: "_content/x.doc.card", type: "doc", fields: { symbol: "🧊" } }).symbol
=> undefined

summarize({ path: "_content/x.doc.card", type: "doc", fields: { symbol: { glyph: "  " } } }).symbol
=> undefined
```
