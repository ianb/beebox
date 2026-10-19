// # card-io: Phase 2 markdown-frontmatter card format
//
// End-to-end round-trip for the `.card` file format. The host (this module) owns
// YAML parsing; the absorbed card layer (`src/cards`) provides the schema
// primitives and the frontmatter splitter.

import { test } from "tap";
import "agent-doctest/tap";
import { z } from "zod";
import {
  cardSchema,
  body,
  type CardSchema,
} from "../../src/exports/cards.js";
import {
  parseCardText,
  serializeCardText,
  loadCardFromText,
  type LoadCardContext,
} from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { errorMessage } from "../../src/shared/error-guards.js";

const docSchema: CardSchema = cardSchema("doc", {
  fields: {
    "drive-id": z.string(),
    title: z.string(),
    body: body(z.string()),
  },
});

const threadSchema: CardSchema = cardSchema("email-thread", {
  fields: {
    "thread-id": z.string(),
    subject: z.string(),
    participants: z.array(z.string()),
  },
});

const schemas = new Map<string, CardSchema>([
  ["doc", docSchema],
  ["email-thread", threadSchema],
]);

// ## Frontmatter-only schemas reject body content
function tryParse2(text: string, source: string): string {
  try { parseCardText(text, { source, schemas }); return "did not throw"; }
  catch (e) { return errorMessage(e); }
}

// ## Loader dispatch parses recognized frontmatter cards
const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([
    ["doc", docSchema],
    ["email-thread", threadSchema],
  ]),
};

// ## A pure-frontmatter card (no body) parses cleanly
void test("A pure-frontmatter card (no body) parses cleanly", async (t) => {
  // doctest:L48
  const text = "---\ntype: email-thread\nthread-id: abc123\nsubject: Re Weekend plans\nparticipants:\n  - alice@example.com\n  - bob@example.com\n---\n";
  const card = parseCardText(text, { source: "thread.email-thread.card", schemas });
  t.check(card.fields, {
    type: "email-thread",
    "thread-id": "abc123",
    subject: "Re Weekend plans",
    participants: [
      "alice@example.com",
      "bob@example.com",
    ],
  });
});

// ## A card with a markdown body parses both halves
void test("A card with a markdown body parses both halves", async (t) => {
  // doctest:L57
  const text = "---\ntype: doc\ndrive-id: drv-1\ntitle: Project Notes\n---\n# Project Notes\n\nBody content goes here.\n";
  const card = parseCardText(text, { source: "x.doc.card", schemas });
  t.check(card.fields["title"], "Project Notes");

  // doctest:L62
  t.check(card.fields["body"], `# Project Notes

Body content goes here.
`);
});

// ## Positional naming: bare `<type>.card` takes its type from the stem
//
// A positional card ("the ‹type› of this directory" — landmarks, briefings,
// nav) has no name segment; the whole stem is the type.
void test("A positional card (\"the ‹type› of this directory\" — landmarks, briefings, nav...", async (t) => {
  // doctest:L72
  const text = "---\ndrive-id: drv-9\ntitle: Directory Doc\n---\nPositional body.\n";
  const card = parseCardText(text, { source: "doc.card", schemas });
  t.check(card.schema.type, "doc");
});

// ## Missing `type` field surfaces a clear error
//
// A single-dot filename is positional, so its "type" is the stem — unknown
// stems fail schema lookup rather than name parsing. A name that fits neither
// form reports the naming convention.
void test("A single-dot filename is positional, so its \"type\" is the stem — unknown stem...", async (t) => {
  // doctest:L85
  const tryParse = (text: string, source: string): string => {
    try { parseCardText(text, { source, schemas }); return "did not throw"; }
    catch (e) { return errorMessage(e); }
  };
  t.check(tryParse("---\nsubject: nope\n---\n", "broken.card"), "broken.card: no schema registered for type \"broken\"");

  // doctest:L92
  t.check(tryParse("---\nsubject: nope\n---\n", "not-a-card"), "not-a-card: cannot determine card type — filename must match Foo.<type>.card or <type>.card");
});

// ## Round-trip: serialize then parse returns the same fields
void test("Round-trip: serialize then parse returns the same fields", async (t) => {
  // doctest:L99
  const fields = {
    type: "doc",
    "drive-id": "drv-42",
    title: "Round-trip",
    body: "Hello, world.\n",
  };
  const text = serializeCardText({ schema: docSchema, fields });
  const parsed = parseCardText(text, { source: "rt.doc.card", schemas });
  t.check(parsed.fields, {
    type: "doc",
    title: "Round-trip",
    "drive-id": "drv-42",
    body: `Hello, world.
`,
  });
});

// ## A long scalar never folds across lines
//
// YAML's `stringify` defaults to wrapping long scalars at ~80 columns; that
// would silently rewrite a long `title` (or any other string field) across
// multiple lines, changing the on-disk representation without changing the
// value. `serializeCardText` disables wrapping, so a long value stays on one
// line and the frontmatter block has exactly three lines (open fence, the one
// `title:` line, close fence).
void test("YAML's stringify defaults to wrapping long scalars at ~80 columns; that would...", async (t) => {
  // doctest:L121
  const longTitle = "A".repeat(150);
  const fields = {
    type: "doc",
    "drive-id": "drv-long",
    title: longTitle,
    body: "Body.\n",
  };
  const text = serializeCardText({ schema: docSchema, fields });
  const frontmatter = text.slice(0, text.indexOf("Body."));
  t.check(frontmatter, `---\ndrive-id: drv-long\ntitle: ${longTitle}\n---\n`);

  // doctest:L133
  const parsed = parseCardText(text, { source: "long.doc.card", schemas });
  t.check(parsed.fields["title"], longTitle);
});

void test("Frontmatter-only schemas reject body content", async (t) => {
  // doctest:L148
  t.check(tryParse2("---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\n---\nunexpected body\n", "extra.email-thread.card"), "extra.email-thread.card: schema \"email-thread\" declares no body, but file has body content");
});

// ## Unknown frontmatter keys are stripped on load (not rejected)
//
// The frontmatter schema is lenient: a key the schema doesn't declare is dropped
// from the parsed fields rather than failing the parse, so a card that has drifted
// past its schema still loads and stays usable. (The unknown key is surfaced as a
// lint *warning* — see `card-lint.doctest.md` — so it gets cleaned off disk.)
void test("The frontmatter schema is lenient:", async (t) => {
  // doctest:L160
  const drifted = parseCardText("---\ntype: doc\ndrive-id: d1\ntitle: T\nbogus-field: oops\n---\n", { source: "typo.doc.card", schemas });
  t.check(drifted.fields, {
    type: "doc",
    title: "T",
    "drive-id": "d1",
    body: "",
  });
});

// A file whose `type:` matches a CardSchema dispatches to the frontmatter path.
void test("A file whose type: matches a CardSchema dispatches to the frontmatter path.", async (t) => {
  // doctest:L179
  const text = "---\ntype: email-thread\nthread-id: t9\nsubject: hi\nparticipants:\n  - a@x\n---\n";
  const loaded = await loadCardFromText({ content: text, source: "thread.email-thread.card", ctx });
  t.check(loaded.kind, "frontmatter");

  // doctest:L184
  t.check(loaded.kind === "frontmatter" ? loaded.schema.type : "?", "email-thread");
});

// Job cards use the dotted filename convention `Foo.<kind>.job.card` (the
// reactor discovers jobs by that suffix) while their schemas register under
// hyphenated names — `*.intake.job.card` dispatches to `intake-job`. This
// regressed once when the filename discriminator only read the last dot
// segment ("job"), making every generated job card fail validation:
void test("Job cards use the dotted filename convention Foo.<kind>.job.card (the reactor...", async (t) => {
  // doctest:L195
  const registryCtx: LoadCardContext = {
    cardSchemas: await createCardSchemaMap(),
  };
  const content = createIntakeJobTemplate({
    connector: "gmail",
    description: "Triage 1 inbox item",
    items: ["_content/inbox/a.doc.card"],
  });
  const loaded = await loadCardFromText({ content, source: "2026-06-09-gmail.intake.job.card", ctx: registryCtx });
  t.check(loaded.kind, "frontmatter");

  // doctest:L207
  t.check(loaded.kind === "frontmatter" ? loaded.schema.type : "?", "intake-job");
});

// A file that isn't a recognized frontmatter card (no `---` block, or a filename
// type with no registered schema) is rejected — there is no XML fallback.
void test("A file that isn't a recognized frontmatter card (no --- block, or a filename...", async (t) => {
  // doctest:L215
  const tryLoad = async (content: string, source: string): Promise<string> => {
    try { await loadCardFromText({ content, source, ctx }); return "did not throw"; }
    catch (e) { return errorMessage(e); }
  };

  // doctest:L220
  t.check(
    // A bare XML body (no frontmatter) no longer loads
    await tryLoad("<doc title=\"Legacy\"/>", "legacy.doc.card"),
    "legacy.doc.card: not a recognized card: no frontmatter block with a registered type",
  );

  // doctest:L224
  t.check(
    // Frontmatter whose filename type has no registered schema is also rejected
    await tryLoad("---\nthread-id: t1\n---\n", "x.unknown.card"),
    "x.unknown.card: not a recognized card: no frontmatter block with a registered type",
  );
});

// ## A landmark may carry a body, the place summary
//
// The landmark type declares a markdown body (docs/implemented-plans/place-shows-cards.md,
// Track C). A landmark with one loads with it; one without still loads, with an
// empty body.
void test("The landmark type declares a markdown body (docs/implemented-plans/place-show...", async (t) => {
  // doctest:L236
  const lmCtx: LoadCardContext = { cardSchemas: await createCardSchemaMap() };
  const bodyOf = async (content: string) => {
    const loaded = await loadCardFromText({ content, source: "Lending.landmark.card", ctx: lmCtx });
    return loaded.kind === "frontmatter" ? loaded.fields["body"] : "?";
  };
  t.check(await bodyOf("---\nnavigation:\n  label: Lending\n---\nThe stove is with Idris until Friday.\n"), "The stove is with Idris until Friday.\n");

  // doctest:L244
  t.check(({ body: await bodyOf("---\nnavigation:\n  label: Lending\n---\n") }), {
    body: "",
  });
});
