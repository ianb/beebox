// # Card Properties: filed at, found by, then the type fields
//
// `CardFacts` is the top of a card's Properties face. It names where the card
// is filed and its type, then the common fields that say how the card is found
// (`contains`, `prominence`, `symbol`, with `contains-evidence` folded under a
// disclosure), then the type fields that `splitCardFields` sends to Properties.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FileData } from "../../../../../src/file-type-registry.js";
import { CardFacts } from "../../../../../src/components/themes/ThemedFileCard/view/CardProperties.js";

globalThis.React = React;

type Schema = NonNullable<FileData["schema"]>;
const docSchema: Schema = { hasBodyField: true, defaultProminence: "ordinary" };

function textOf(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

/** Each `<dt>`/`<dd>` pair as "label = value", in order. */
function rows(html: string) {
  return [...html.matchAll(/<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gs)].map(([, label, value]) => `${textOf(label ?? "")} = ${textOf(value ?? "")}`);
}

function render(data: FileData) {
  return renderToStaticMarkup(React.createElement(CardFacts, { data, boxSlug: "test", onNavigate: () => {} }));
}

const filedAs = (path: string, type: string): string =>
  `<dl class="mt-4"><dt>Filed at</dt><dd>${path}</dd><dt>Card type</dt><dd>${type}</dd></dl>`;
/** The "Found by" section for a card whose only row is its prominence. */
const foundBy = (prominence: string, extraRows: string): string =>
  `<div class="mt-6" data-card-section="found-by"><h3 class="text-sm font-semibold mb-2">Found by</h3><dl><dt>Prominence</dt><dd>${prominence}, the type&#x27;s default</dd>${extraRows}</dl></div>`;
/** The "Fields" section holding one row. */
const fieldsSection = (label: string, value: string): string =>
  `<div class="mt-6" data-card-section="fields"><h3 class="text-sm font-semibold mb-2">Fields</h3><dl class="min-w-0 max-w-full grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm text-warm-800 bbx-card-fields"><div class="contents"><dt class="min-w-0 max-w-32 text-warm-700 text-right whitespace-pre-wrap [overflow-wrap:anywhere] bbx-card-field-label">${label}</dt><dd class="min-w-0 max-w-full"><span class="whitespace-pre-wrap [overflow-wrap:anywhere]">${value}</span></dd></div></dl></div>`;

const doc = render({
  path: "_content/projects/Porch.doc.card",
  kind: "frontmatter",
  type: "doc",
  schema: docSchema,
  frontmatter: {
    title: "Porch",
    contains: "Porch repair quotes",
    "contains-evidence": "Three quotes in the body",
    symbol: { glyph: "🏠", background: "#fde" },
    todos: [{ text: "Book the inspector" }],
    "share-id": "porch-quotes",
    via: { channel: "email" },
  },
  body: "Three quotes so far.\n",
});

// A doc with no declared `prominence` shows its type's default and says so.
// The doc has a body, so its type fields are here rather than on the front.
// The symbol row draws the mark and the group as written. The doc's own fields
// follow, in the shared fields table; the title, todos, and theme are shown
// elsewhere and are not repeated:
void test("A doc with no declared prominence shows its type's default and says so.", async (t) => {
  t.check(rows(doc), [
    "Filed at = projects/Porch.doc.card",
    "Card type = doc",
    "Contains = Porch repair quotes",
    "Prominence = ordinary, the type's default",
    "Symbol = 🏠 glyph: 🏠 · background: #fde",
    "Share id = porch-quotes",
    "Via = Channel email",
  ]);
});

// The fields table reads its keys as labels and small objects as one value
// (`src/frontend/test/lib/readable-fields.test.ts`). A record is headed by its `name:`
// (`cardTitle`), so the table leaves out the `name` row that would repeat the
// header:
void test("The fields table reads its keys as labels and small objects as one value (tes...", async (t) => {
  t.check(
    rows(render({
      path: "_content/lending/Camp_stove.record.card",
      type: "record",
      schema: docSchema,
      frontmatter: { name: "Camp stove", location: { text: "With Idris" }, quantity: { value: "1 stove", note: "missing lid" } },
      body: "Borrowed for the lake trip.\n",
    })),
    [
    "Filed at = lending/Camp_stove.record.card",
    "Card type = record",
    "Prominence = ordinary, the type's default",
    "Location = With Idris",
    "Quantity = 1 stove (missing lid)",
  ],
  );
});

// The evidence for `contains` sits under a closed disclosure:
void test("The evidence for contains sits under a closed disclosure:", async (t) => {
  t.check(doc.match(/<details[^>]*>.*?<\/details>/s)?.[0].replace(/ class="[^"]*"/g, ""), "<details><summary>Contains evidence</summary><p>Three quotes in the body</p></details>");
});

// A declared level shows as declared:
void test("A declared level shows as declared:", async (t) => {
  t.check(rows(render({ path: "_content/Plan.doc.card", type: "doc", schema: docSchema, frontmatter: { prominence: "primary" } })), [
    "Filed at = Plan.doc.card",
    "Card type = doc",
    "Prominence = primary",
  ]);
});

// A card that failed validation has no schema facts (`schema: null`), so
// Properties cannot name the type's default: it shows a declared value as
// written, or no Prominence row at all. Its type fields stay on the front
// (`splitCardFields`), so Properties has no fields table:
void test("A card that failed validation has no schema facts (schema:", async (t) => {
  const broken = { path: "_content/Broken.doc.card", type: "doc", schema: null };
  t.check(rows(render({ ...broken, frontmatter: { prominence: "global", status: [1, 2] } })), [
    "Filed at = Broken.doc.card",
    "Card type = doc",
    "Prominence = global",
  ]);

  t.check(rows(render({ ...broken, frontmatter: { status: [1, 2] } })), [
    "Filed at = Broken.doc.card",
    "Card type = doc",
  ]);
});

// A landmark's body is the place summary, and most landmarks have none. With an
// empty body, `splitCardFields` sends the type fields to the front, but the place
// page replaces that front and draws no fields. So for a landmark Properties
// shows them under Fields whether or not it has a body; otherwise `navigation`
// would show only in Source (docs/implemented-plans/landmark-arrival.md, Track C;
// docs/implemented-plans/place-shows-cards.md, Track C).
void test("A landmark's body is the place summary, and most landmarks have none.", async (t) => {
  const landmarkSchema: Schema = { hasBodyField: true, defaultProminence: "background" };
  const landmark = (body: string | undefined) => render({
    path: "_content/lending/Lending.landmark.card",
    type: "landmark",
    schema: landmarkSchema,
    frontmatter: { symbol: { glyph: "🤝" }, navigation: { label: "Lending" } },
    body,
  });
  const expected = filedAs("lending/Lending.landmark.card", "landmark")
    + foundBy("background", '<dt>Symbol</dt><dd class="flex items-center gap-2"><span class="inline-flex items-center justify-center flex-shrink-0 overflow-hidden w-5 h-5 text-sm" aria-hidden="true">🤝</span><span>glyph: 🤝</span></dd>')
    + fieldsSection("Navigation", "Lending");
  t.check([landmark(undefined), landmark("The stove is with Idris.\n")], [expected, expected]);
});

// Other body-less types keep their fields on the front.
void test("Other body-less types keep their fields on the front.", async (t) => {
  const bodiless: Schema = { hasBodyField: false, defaultProminence: "ordinary" };
  const question = render({ path: "_content/Q.question.card", type: "question", schema: bodiless, frontmatter: { question: "Which?" } });
  t.check(question, filedAs("Q.question.card", "question") + foundBy("ordinary", ""));
});

// ## An empty body leaves the type fields on the front
//
// With no body text, the front shows the type fields
// (`src/frontend/test/lib/card-field-faces.test.ts`), so Properties lists no Fields
// section and nothing shows twice. A body that only repeats the title counts as
// empty, the same test the front uses.
void test("With no body text, the front shows the type fields (test/lib/card-field-faces...", async (t) => {
  const emptyDoc = (body: string | undefined) => render({
    path: "_content/projects/Porch.doc.card", type: "doc", schema: docSchema,
    frontmatter: { title: "Porch", "share-id": "porch-quotes" }, body,
  });
  const front = filedAs("projects/Porch.doc.card", "doc") + foundBy("ordinary", "");
  t.check([emptyDoc(undefined), emptyDoc("# Porch\n"), emptyDoc("Quotes.\n")], [
    front,
    front,
    front + fieldsSection("Share id", "porch-quotes"),
  ]);
});
