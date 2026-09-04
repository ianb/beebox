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
