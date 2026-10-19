// # Loader Registry
//
// Produces `FileSummary` values for files. A card's summary belongs to its card
// type: the registry builds the standard base and hands it to the schema's
// `summarize` hook. Non-card files go through path loaders registered here.

import { test } from "tap";
import "agent-doctest/tap";
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

// ## Base summary: filename, `title:`, `contains:`, `symbol:`
//
// A file with no card type gets the filename, cleaned up.
void test("A file with no card type gets the filename, cleaned up.", async (t) => {
  // doctest:L30
  resetLoaderRegistry();
  t.check(summarize({ path: "_content/inbox/Meeting_Notes.doc.card" }, NO_SCHEMAS), {
    path: "_content/inbox/Meeting_Notes.doc.card",
    title: "Meeting Notes",
  });

  // doctest:L34
  t.check(summarize({ path: "photo-001.jpg" }, NO_SCHEMAS), { path: "photo-001.jpg", title: "photo 001" });

  // `title`, `contains` and `symbol` belong to every card, so the registry reads
  // them rather than each card type remembering to.

  // doctest:L42
  const s = summarize({
    path: "_content/figures/Cube.figure.card",
    type: "figure",
    fields: { title: "Rotating Cube Demo", contains: "A spinning cube.", symbol: { glyph: "🧊" }, theme: { name: "paper", stock: "blue" } },
  }, NO_SCHEMAS);
  t.check(s, {
    path: "_content/figures/Cube.figure.card",
    title: "Rotating Cube Demo",
    type: "figure",
    cardTheme: { name: "paper", stock: "blue" },
    contains: "A spinning cube.",
    symbol: { glyph: "🧊" },
  });

  // An authored theme is carried through as authored. Theme names are an open set,
  // so a name the engine ships no palette for is still the card's explicit choice
  // and reaches the renderer to fall back there — dropping it here would let a box
  // or schema default silently win over something the author wrote. A theme of the
  // wrong SHAPE carries nothing, and resolves to plain.

  // doctest:L58
  const unknownTheme = summarize({ path: "_content/x.doc.card", type: "doc", fields: { theme: { name: "velvet" } } }, NO_SCHEMAS);
  t.check(unknownTheme, {
    path: "_content/x.doc.card",
    title: "x",
    type: "doc",
    cardTheme: { name: "velvet", stock: "neutral" },
  });

  // doctest:L62
  const malformedTheme = summarize({ path: "_content/y.doc.card", type: "doc", fields: { theme: "paper" } }, NO_SCHEMAS);
  t.check(malformedTheme, {
    path: "_content/y.doc.card",
    title: "y",
    type: "doc",
    cardTheme: { name: "plain", stock: "neutral" },
  });

  // doctest:L66
  const raw = summarize({ path: "_content/x.txt" }, NO_SCHEMAS);
  t.check(raw, { path: "_content/x.txt", title: "x" });

  // A malformed symbol is dropped rather than shipped — `readCardSymbol` validates
  // before it resolves.

  // doctest:L75
  t.check(summarize({ path: "_content/x.doc.card", type: "doc", fields: { symbol: "🧊" } }, NO_SCHEMAS), {
    path: "_content/x.doc.card",
    title: "x",
    type: "doc",
  });

  // doctest:L78
  t.check(summarize({ path: "_content/x.doc.card", type: "doc", fields: { symbol: { glyph: "  " } } }, NO_SCHEMAS), {
    path: "_content/x.doc.card",
    title: "x",
    type: "doc",
  });
});

// ## A card type with no `summarize` gets the base
void test("A card type with no `summarize` gets the base", async (t) => {
  // doctest:L85
  resetLoaderRegistry();
  const PlainSchema = cardSchema("plain", { fields: { note: z.string() } });
  const s = summarize(
    { path: "_content/notes/Old_Name.plain.card", type: "plain", fields: { type: "plain", note: "hi", title: "New Name" } },
    schemaMap(PlainSchema),
  );
  t.check(s, {
    path: "_content/notes/Old_Name.plain.card",
    title: "New Name",
    type: "plain",
  });
});

// ## Extending the base: `{ ...base, detail }`
//
// The common case. The type keeps the standard title and adds a second line.
void test("The common case.", async (t) => {
  // doctest:L100
  resetLoaderRegistry();
  const TaskSchema = cardSchema("task", {
    fields: { state: z.enum(["open", "done"]), owner: z.string().optional() },
    summarize: (card, base) => ({ ...base, detail: card.owner === undefined ? card.state : `${card.state} · ${card.owner}` }),
  });
  const s = summarize(
    { path: "_content/work/Rewire_Lamp.task.card", type: "task", fields: { type: "task", state: "open", owner: "Dana Whitfield", contains: "The rewiring job." } },
    schemaMap(TaskSchema),
  );
  t.check(s, {
    path: "_content/work/Rewire_Lamp.task.card",
    title: "Rewire Lamp",
    type: "task",
    contains: "The rewiring job.",
    detail: "open · Dana Whitfield",
  });

  // `summaryText` is the text form of the same summary, for the agent-facing
  // surfaces that have no React tree.

  // doctest:L117
  t.check(summaryText(s), "Rewire Lamp — open · Dana Whitfield");

  // doctest:L120
  t.check(summaryText({ path: "a.card", title: "Just a title" }), "Just a title");

  // doctest:L123
  t.check(summaryText({ path: "a.card", title: "Blank detail", detail: "   " }), "Blank detail");
});

// ## Replacing the base, and typed `attrs`
//
// A type whose title is not its filename replaces it, and hands its list
// component a typed payload.
void test("A type whose title is not its filename replaces it, and hands its list compon...", async (t) => {
  // doctest:L133
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
  t.check(s, {
    path: "_content/Q.quote.card",
    title: "Kaito Ishikawa",
    type: "quote",
    detail: "14 characters",
    attrs: { length: 14 },
  });

  // ## A card that failed validation keeps the base from its filename
  //
  // `summarize` runs only on fields a schema vouched for. When the card didn't
  // load, the registry has no fields to hand over, and the row is still the row.

  // doctest:L156
  t.check(summarize({ path: "_content/Broken_Quote.quote.card" }, schemaMap(QuoteSchema)), {
    path: "_content/Broken_Quote.quote.card",
    title: "Broken Quote",
  });
});

// ## A hook never sees fields its schema did not vouch for
//
// A `summarize` hook is typed as receiving this type's validated fields, and it
// is entitled to read them that way — `card.state.toUpperCase()` on a card type
// whose `state` is a `z.enum`. The production callers load the card first, so
// its fields were validated; `summarize` is exported, though, and a caller that
// hands over a raw bag must not be the one that makes a schema's hook wrong.
// The fields are checked against the schema before the hook is called, and a bag
// that fails keeps the base summary.
void test("A summarize hook is typed as receiving this type's validated fields, and it i...", async (t) => {
  // doctest:L171
  resetLoaderRegistry();
  const calls: string[] = [];
  const ImageSchema = cardSchema("image", {
    fields: { status: z.enum(["draft", "published"]) },
    summarize: (card, base) => {
      calls.push(card.status);
      return { ...base, detail: card.status.toUpperCase() };
    },
  });
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => { warnings.push(msg); };
  const s = summarize({ path: "_content/Kite.image.card", type: "image", fields: { type: "image", status: 7 } }, schemaMap(ImageSchema));
  console.warn = original;
  t.check([s, calls], [{ path: "_content/Kite.image.card", title: "Kite", type: "image" }, []]);

  // The fall back is visible, not silent: whoever called `summarize` that way gets
  // told which field was wrong.

  // doctest:L193
  t.check(warnings, ["summarize() was handed unvalidated \"image\" fields for _content/Kite.image.card; using the base summary:"]);

  // Validated fields reach the hook exactly as before.

  // doctest:L200
  t.check(summarize({ path: "_content/Kite.image.card", type: "image", fields: { type: "image", status: "draft" } }, schemaMap(ImageSchema)), {
    path: "_content/Kite.image.card",
    title: "Kite",
    type: "image",
    detail: "DRAFT",
  });

  // The hook reads what the schema parsed, so a field the caller left out arrives
  // with its default, and the body (which the frontmatter schema does not know)
  // still comes through.

  // doctest:L209
  const NoteSchema = cardSchema("note", {
    fields: { state: z.enum(["new", "kept"]).default("new"), body: body(z.string()) },
    summarize: (card, base) => ({ ...base, detail: `${card.state}: ${card.body}` }),
  });
  t.check(summarize({ path: "_content/Kite.note.card", type: "note", fields: { type: "note", body: "string is frayed" } }, schemaMap(NoteSchema)), {
    path: "_content/Kite.note.card",
    title: "Kite",
    type: "note",
    detail: "new: string is frayed",
  });
});

// ## A `summarize` that throws is a bug in that schema, not a lost row
void test("A `summarize` that throws is a bug in that schema, not a lost row", async (t) => {
  // doctest:L220
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
  t.check(s, { path: "_content/Thing.bad.card", title: "Thing", type: "bad" });

  // doctest:L238
  t.check(warnings, ["summarize() for card type \"bad\" failed on _content/Thing.bad.card; using the base summary:"]);
});

// ## An empty title falls back to the base title
//
// A blank title renders a blank row; the base title always says something.
void test("A blank title renders a blank row; the base title always says something.", async (t) => {
  // doctest:L247
  resetLoaderRegistry();
  const EmptySchema = cardSchema("empty", {
    fields: { n: z.number() },
    summarize: (_card, base) => ({ ...base, title: "   ", detail: "still here" }),
  });
  const s = summarize({ path: "_content/Some_Card.empty.card", type: "empty", fields: { type: "empty", n: 1 } }, schemaMap(EmptySchema));
  t.check(s, {
    path: "_content/Some_Card.empty.card",
    title: "Some Card",
    type: "empty",
    detail: "still here",
  });
});

// ## Path loaders still answer for non-card files
//
// Cards never reach these — their type's schema answers for them.
void test("Cards never reach these — their type's schema answers for them.", async (t) => {
  // doctest:L262
  resetLoaderRegistry();
  registerPathLoader<Record<string, never>>(
    (p: string) => p.endsWith(".md"),
    (raw) => ({ path: raw.path, title: `md:${raw.path}`, attrs: {} }),
  );
  t.check(summarize({ path: "store/notes/todo.md" }, NO_SCHEMAS), { path: "store/notes/todo.md", title: "md:store/notes/todo.md", attrs: {} });

  // A path loader's own title wins over the filename — it computed it on purpose.
  // Two matching loaders is a registration mistake: the first wins, loudly.

  // doctest:L275
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => { warnings.push(msg); };
  const second: FileLoader<Record<string, never>> = (raw) => ({ path: raw.path, title: "second", attrs: {} });
  registerPathLoader((p: string) => p.endsWith(".md"), second);
  const s = summarize({ path: "store/notes/todo.md" }, NO_SCHEMAS);
  console.warn = original;
  t.check([s, warnings], [
    { path: "store/notes/todo.md", title: "md:store/notes/todo.md", attrs: {} },
    ['Path loader collision for "store/notes/todo.md": 2 matches; using first registered'],
  ]);
});

// ## A landmark is listed under its place's name
//
// A landmark card stands for its place, so its summary title is the
// `navigation.label` the place pill and the "Go to" buttons show, and the
// workspace tab above the place page agrees with them. A landmark with no label
// keeps its filename.
void test("A landmark card stands for its place, so its summary title is the navigation....", async (t) => {
  t.teardown(async () => {
    try {
      resetLoaderRegistry();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L294
  const { LandmarkSchema } = await import("../../src/schemas/landmark.js");
  const landmarks = schemaMap(LandmarkSchema);
  t.check([
    summarize({ path: "_content/chem/Intro_Chemistry.landmark.card", type: "landmark", fields: { type: "landmark", navigation: { label: "Chemistry" } } }, landmarks),
    summarize({ path: "_content/inbox/Inbox.landmark.card", type: "landmark", fields: { type: "landmark" } }, landmarks),
  ], [
    { path: "_content/chem/Intro_Chemistry.landmark.card", title: "Chemistry", type: "landmark" },
    { path: "_content/inbox/Inbox.landmark.card", title: "Inbox", type: "landmark" },
  ]);
});
