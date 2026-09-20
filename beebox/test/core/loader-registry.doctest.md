# Loader Registry

Produces `FileSummary` values for files. A card's summary belongs to its card
type: the registry builds the standard base and hands it to the schema's
`summarize` hook. Non-card files go through path loaders registered here.

```ts setup
import {
  registerPathLoader,
  resetLoaderRegistry,
  summarize,
} from "../../src/core/loader-registry.js";
import { summaryText, type FileLoader } from "../../src/core/file-summary.js";
import { cardSchema, body, type CardSchema } from "../../src/cards/schema.js";
import { z } from "zod";

/** The box's schema map, as `buildLoadContext` produces it. */
function schemaMap(...schemas: CardSchema[]): Map<string, CardSchema> {
  return new Map(schemas.map(s => [s.type, s]));
}

const NO_SCHEMAS = new Map<string, CardSchema>();
```

## Base summary: filename, `title:`, `contains:`, `symbol:`

A file with no card type gets the filename, cleaned up.

```ts
resetLoaderRegistry();
summarize({ path: "_content/inbox/Meeting_Notes.memo.card" }, NO_SCHEMAS).title
=> Meeting Notes

summarize({ path: "photo-001.jpg" }, NO_SCHEMAS).title
=> photo 001
```

`title`, `contains` and `symbol` belong to every card, so the registry reads
them rather than each card type remembering to.

```ts continue
const s = summarize({
  path: "_content/figures/Cube.figure.card",
  type: "figure",
  fields: { title: "Rotating Cube Demo", contains: "A spinning cube.", symbol: { glyph: "🧊" }, theme: { name: "paper", stock: "blue" } },
}, NO_SCHEMAS);
[s.type, s.title, s.contains, s.symbol?.glyph, s.cardTheme?.name, s.cardTheme?.stock].join("|")
=> figure|Rotating Cube Demo|A spinning cube.|🧊|paper|blue
```

An authored theme is carried through as authored. Theme names are an open set,
so a name the engine ships no palette for is still the card's explicit choice
and reaches the renderer to fall back there — dropping it here would let a box
or schema default silently win over something the author wrote. A theme of the
wrong SHAPE carries nothing, and resolves to plain.

```ts continue
const unknownTheme = summarize({ path: "_content/x.doc.card", type: "doc", fields: { theme: { name: "velvet" } } }, NO_SCHEMAS);
JSON.stringify([unknownTheme.type, unknownTheme.cardTheme])
=> ["doc",{"name":"velvet","stock":"neutral"}]

const malformedTheme = summarize({ path: "_content/y.doc.card", type: "doc", fields: { theme: "paper" } }, NO_SCHEMAS);
JSON.stringify(malformedTheme.cardTheme)
=> {"name":"plain","stock":"neutral"}

const raw = summarize({ path: "_content/x.txt" }, NO_SCHEMAS);
JSON.stringify([raw.type, raw.cardTheme])
=> [null,null]
```

A malformed symbol is dropped rather than shipped — `readCardSymbol` validates
before it resolves.

```ts continue
summarize({ path: "_content/x.doc.card", type: "doc", fields: { symbol: "🧊" } }, NO_SCHEMAS).symbol
=> undefined

summarize({ path: "_content/x.doc.card", type: "doc", fields: { symbol: { glyph: "  " } } }, NO_SCHEMAS).symbol
=> undefined
```

## A card type with no `summarize` gets the base

```ts
resetLoaderRegistry();
const PlainSchema = cardSchema("plain", { fields: { note: z.string() } });
const s = summarize(
  { path: "_content/notes/Old_Name.plain.card", type: "plain", fields: { type: "plain", note: "hi", title: "New Name" } },
  schemaMap(PlainSchema),
);
JSON.stringify(s)
=> {"path":"_content/notes/Old_Name.plain.card","title":"New Name","type":"plain"}
```

## Extending the base: `{ ...base, detail }`

The common case. The type keeps the standard title and adds a second line.

```ts
resetLoaderRegistry();
const TaskSchema = cardSchema("task", {
  fields: { state: z.enum(["open", "done"]), owner: z.string().optional() },
  summarize: (card, base) => ({ ...base, detail: card.owner === undefined ? card.state : `${card.state} · ${card.owner}` }),
});
const s = summarize(
  { path: "_content/work/Rewire_Lamp.task.card", type: "task", fields: { type: "task", state: "open", owner: "Dana Whitfield", contains: "The rewiring job." } },
  schemaMap(TaskSchema),
);
JSON.stringify(s)
=> {"path":"_content/work/Rewire_Lamp.task.card","title":"Rewire Lamp","type":"task","contains":"The rewiring job.","detail":"open · Dana Whitfield"}
```

`summaryText` is the text form of the same summary, for the agent-facing
surfaces that have no React tree.

```ts continue
summaryText(s)
=> Rewire Lamp — open · Dana Whitfield

summaryText({ path: "a.card", title: "Just a title" })
=> Just a title

summaryText({ path: "a.card", title: "Blank detail", detail: "   " })
=> Blank detail
```

## Replacing the base, and typed `attrs`

A type whose title is not its filename replaces it, and hands its list
component a typed payload.

```ts
resetLoaderRegistry();
interface QuoteAttrs { length: number }
const QuoteSchema = cardSchema("quote", {
  fields: { said: z.string(), body: body(z.string()) },
  summarize: (card, base) => {
    const attrs: QuoteAttrs = { length: card.body.length };
    return { ...base, title: card.said, detail: `${String(card.body.length)} characters`, attrs };
  },
});
const s = summarize(
  { path: "_content/Q.quote.card", type: "quote", fields: { type: "quote", said: "Kaito Ishikawa", body: "Measure twice." } },
  schemaMap(QuoteSchema),
);
[s.title, s.detail, JSON.stringify(s.attrs)].join("|")
=> Kaito Ishikawa|14 characters|{"length":14}
```

## A card that failed validation keeps the base from its filename

`summarize` runs only on fields a schema vouched for. When the card didn't
load, the registry has no fields to hand over, and the row is still the row.

```ts continue
JSON.stringify(summarize({ path: "_content/Broken_Quote.quote.card" }, schemaMap(QuoteSchema)))
=> {"path":"_content/Broken_Quote.quote.card","title":"Broken Quote"}
```

## A `summarize` that throws is a bug in that schema, not a lost row

```ts
resetLoaderRegistry();
const BadSchema = cardSchema("bad", {
  fields: { n: z.number() },
  summarize: () => { throw new Error("schema author's bug"); },
});
const warnings: string[] = [];
const original = console.warn;
console.warn = (msg: string) => { warnings.push(msg); };
const s = summarize({ path: "_content/Thing.bad.card", type: "bad", fields: { type: "bad", n: 1 } }, schemaMap(BadSchema));
console.warn = original;
s.title
=> Thing

warnings.length
=> 1
```

```ts continue
warnings[0]
=> summarize() for card type "bad" failed on _content/Thing.bad.card; using the base summary:
```

## An empty title falls back to the base title

A blank title renders a blank row; the base title always says something.

```ts
resetLoaderRegistry();
const EmptySchema = cardSchema("empty", {
  fields: { n: z.number() },
  summarize: (_card, base) => ({ ...base, title: "   ", detail: "still here" }),
});
const s = summarize({ path: "_content/Some_Card.empty.card", type: "empty", fields: { type: "empty", n: 1 } }, schemaMap(EmptySchema));
[s.title, s.detail].join("|")
=> Some Card|still here
```

## Path loaders still answer for non-card files

Cards never reach these — their type's schema answers for them.

```ts
resetLoaderRegistry();
registerPathLoader<Record<string, never>>(
  (p: string) => p.endsWith(".md"),
  (raw) => ({ path: raw.path, title: `md:${raw.path}`, attrs: {} }),
);
summarize({ path: "store/notes/todo.md" }, NO_SCHEMAS).title
=> md:store/notes/todo.md
```

A path loader's own title wins over the filename — it computed it on purpose.
Two matching loaders is a registration mistake: the first wins, loudly.

```ts continue
const warnings: string[] = [];
const original = console.warn;
console.warn = (msg: string) => { warnings.push(msg); };
const second: FileLoader<Record<string, never>> = (raw) => ({ path: raw.path, title: "second", attrs: {} });
registerPathLoader((p: string) => p.endsWith(".md"), second);
const s = summarize({ path: "store/notes/todo.md" }, NO_SCHEMAS);
console.warn = original;
[s.title, String(warnings.length)].join("|")
=> md:store/notes/todo.md|1
```

```ts cleanup
resetLoaderRegistry();
```
