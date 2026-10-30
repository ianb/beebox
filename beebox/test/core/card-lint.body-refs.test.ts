// # card-lint: body refs, links, and per-type rules
//
// Continues [card-lint.test.ts](card-lint.test.ts). This part covers broken refs and inline links in card bodies, `attach/` scope, cards of types without a schema, commentary and extfile cards, and a schema's `validate` hook.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../../src/exports/cards.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { lintCardsDispatch } from "../../src/core/card-lint/core/lint-cards.js";
import type { LoadCardContext } from "../../src/core/card-io.js";
import { CommentarySchema } from "../../src/schemas/commentary.js";
import { ExtfileSchema } from "../../src/schemas/extfile.js";
import { LandmarkSchema } from "../../src/schemas/landmark.js";
import { FigureSchema } from "../../src/schemas/figure.js";
import { ChatSchema } from "../../src/schemas/chat.js";
import { ImageSchema } from "../../src/schemas/image/schema.js";

const threadSchema: CardSchema = cardSchema("email-thread", {
  fields: {
    "thread-id": z.string(),
    subject: z.string(),
    participants: z.array(z.string()),
    "date-range": z.object({
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
    }),
    messages: z.array(z.object({ ref: z.string() })),
  },
});

const docSchema: CardSchema = cardSchema("doc", {
  fields: {
    title: z.string(),
    body: body(z.string()),
  },
});

// A throwaway type whose only special rule lives in a self-contained `validate`
// hook on its schema — proves card-lint's dispatch invokes whatever `validate`
// a schema declares, generically, without knowing the type name. The hook sees
// only the card's own parsed fields (no loader / box access).
const gadgetSchema: CardSchema = cardSchema("gadget", {
  fields: { mode: z.string() },
  validate: ({ fields }) =>
    fields["mode"] === "forbidden"
      ? [{ type: "validation", severity: "error", message: "gadget mode must not be \"forbidden\"" }]
      : [],
});

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([
    ["email-thread", threadSchema],
    ["doc", docSchema],
    ["commentary", CommentarySchema],
    ["extfile", ExtfileSchema],
    ["gadget", gadgetSchema],
    ["landmark", LandmarkSchema],
    ["figure", FigureSchema],
    ["chat", ChatSchema],
    ["image", ImageSchema],
  ]),
};

// ## Broken refs in Markdoc body tags surface as warnings too
//
// Refs carried by Markdoc tag attributes inside a card body (e.g.
// `{% source ref="..." %}`, `{% subrecipe ref="..." %}`) get the same
// broken-ref treatment as frontmatter refs — resolved against the box,
// missing targets reported as warnings. The path field on the warning
// points at `body:<line>:<tagName>.<attr>` so the human can locate it.
// Ref paths follow the same convention as frontmatter refs: leading `/`
// is box-root-absolute (the convention recommended by `record.tsx`'s
// instructions); bare paths are resolved relative to the source card.
void test("Refs carried by Markdoc tag attributes inside a card body (e.g.", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nDana made the call: {% source ref=\"/_content/box/people/missing.person.card\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/box/notes/Meeting.doc.card"),
      errors: [],
      warnings: [
        { type: "reference", severity: "warning", message: "Broken reference at body:1:source.ref: /_content/box/people/missing.person.card does not exist" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// ## A display-form path in a body Markdoc tag `ref` is a lint ERROR
void test("A display-form path in a body Markdoc tag `ref` is a lint ERROR", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"Config:box.json\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/box/notes/Meeting.doc.card"),
      errors: [
        { type: "display-path", severity: "error", message: "Display-form path at body:1:source.ref: `Config:box.json` is the boxholder's display form; write `/_config/box.json`" },
      ],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 1,
    totalWarnings: 0,
  });

});

// ## Inline markdown links in a card body are checked too
//
// `bbx mv` has always rewritten `[text](path)` / `![alt](path)` inside card
// bodies; validate never looked at them, so a link broken by a hand-edit or a
// delete stayed silent until someone clicked it. They are now walked like any
// other ref — `type: "reference"` warnings that land in the broken-ref count.
void test("bbx mv has always rewritten [text](path) / ![alt](path) inside card bodies; v...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/box/notes/Plan.doc.card",
    "---\ntype: doc\ntitle: Plan\n---\nSee [the brief](/_content/box/notes/missing.doc.card).\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Plan.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/box/notes/Plan.doc.card"),
      errors: [],
      warnings: [
        { type: "reference", severity: "warning", message: "Broken reference at body:1:link: /_content/box/notes/missing.doc.card does not exist" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// A display-form path written into an inline link, or a reference-style link
// DEFINITION, is a lint ERROR too — `body-refs.ts`'s extractors no longer treat
// it as external (`isExternalRef`'s scheme pattern also matches
// `Config:box.json`), so it reaches this same display-form check instead of
// being silently dropped:
void test("A display-form path written into an inline link, or a reference-style link DE...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/box/notes/Inline.doc.card",
    "---\ntype: doc\ntitle: Inline\n---\nSee [config](Config:box.json).\n",
  );
  const inlineResult = await lintCardsDispatch(
    [box.path("_content/box/notes/Inline.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(inlineResult, {
    results: [{
      path: box.path("_content/box/notes/Inline.doc.card"),
      errors: [
        { type: "display-path", severity: "error", message: "Display-form path at body:1:link: `Config:box.json` is the boxholder's display form; write `/_config/box.json`" },
      ],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 1,
    totalWarnings: 0,
  });

  const box2 = await makeTmpBox();
  await box2.write(
    "_content/box/notes/RefDef.doc.card",
    "---\ntype: doc\ntitle: RefDef\n---\nSee [config][1].\n\n[1]: Bookkeeping:jobs/x.job.card\n",
  );
  const refDefResult = await lintCardsDispatch(
    [box2.path("_content/box/notes/RefDef.doc.card")],
    { boxRoot: box2.root, ctx },
  );
  t.check(refDefResult, {
    results: [{
      path: box2.path("_content/box/notes/RefDef.doc.card"),
      errors: [
        { type: "display-path", severity: "error", message: "Display-form path at body:3:ref-def: `Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`" },
      ],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 1,
    totalWarnings: 0,
  });

});

// Links that resolve are clean, and links that name nothing in the box —
// a URL scheme, a protocol-relative `//host`, or a bare `#anchor` — are skipped
// rather than resolved as paths:
void test("Links that resolve are clean, and links that name nothing in the box — a URL...", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/box/notes/Brief.doc.card", "---\ntype: doc\ntitle: Brief\n---\nx\n");
  await box.write("_content/box/notes/Plan.attach/chart.png", "PNG");
  await box.write(
    "_content/box/notes/Plan.doc.card",
    "---\ntype: doc\ntitle: Plan\n---\n" +
      "Rel [brief](Brief.doc.card), abs [brief again](/_content/box/notes/Brief.doc.card), " +
      "attached ![chart](attach/chart.png).\n" +
      "Off-box: [site](https://example.com/x), [cdn](//cdn.example.com/x), " +
      "[mail](mailto:dana@example.com), [top](#summary).\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Plan.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/box/notes/Plan.doc.card"),
      errors: [],
      warnings: [
        { type: "canonical", severity: "warning", message: "Non-canonical ref at body:1:link: Brief.doc.card → /_content/box/notes/Brief.doc.card" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// The one warning is the relative-ref deprecation notice (Track B) for the
// document-relative `[brief](Brief.doc.card)` link — everything else in that
// body (the box-root-absolute link, the `attach/` image, and the four
// external/off-box forms) is already canonical or not a box ref at all.
//
// ## Ref existence honors `attach/` scope
//
// The broken-ref walk resolves an `attach/`-prefixed ref into the referring
// card's `<basename>.attach/` scope. An `attach/` ref resolving into the card's
// attach scope is clean; a missing one in the same scope warns:
void test("The one warning is the relative-ref deprecation notice (Track B) for the docu...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/box/notes/Note.doc.card",
    "---\ntype: doc\ntitle: N\n---\nok {% source ref=\"attach/photo.jpg\" usage=\"a\" %}{% /source %} bad {% source ref=\"attach/missing.jpg\" usage=\"b\" %}{% /source %}\n",
  );
  await box.write("_content/box/notes/Note.attach/photo.jpg", "JPG");
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Note.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/box/notes/Note.doc.card"),
      errors: [],
      warnings: [
        { type: "reference", severity: "warning", message: "Broken reference at body:1:source.ref: attach/missing.jpg does not exist" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// ## A card whose type has no registered schema warns, never errors
//
// There's no XML loader fallback anymore: a `.card` with frontmatter whose
// filename type isn't a registered schema (a typo, or a box-local type the test
// ctx doesn't include) is surfaced as a non-blocking warning rather than failing.
void test("There's no XML loader fallback anymore:", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/Note.unknowntype.card",
    "---\nstatus: new\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/Note.unknowntype.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/inbox/Note.unknowntype.card"),
      errors: [],
      warnings: [
        { type: "schema", severity: "warning", message: "no schema registered for card type \"unknowntype\" — card not validated" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// A `.card` with no frontmatter block at all is malformed (every card is
// frontmatter now). It's surfaced as a warning — visible, but non-blocking so one
// stray card doesn't brick a box's pre-commit/automation:
void test("A .card with no frontmatter block at all is malformed (every card is frontmat...", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/inbox/Broken.doc.card", "this is not a frontmatter card\n");
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/Broken.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/inbox/Broken.doc.card"),
      errors: [],
      warnings: [
        { type: "schema", severity: "warning", message: "card has no frontmatter block" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// ## An attach-only commentary card with valid anchors lints clean
//
// Commentary is attach-only — it carries no target field; bare `{% source %}`
// anchors point at the containing host card.
void test("Commentary is attach-only — it carries no target field; bare {% source %} anc...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/store/review/Plan.attach/Plan.commentary.card",
    "---\ntype: commentary\n---\n{% source pos=\"body; ~line 4\" version=\"sha256:9f3a1c2b\" %}{% quote %}a span{% /quote %}{% /source %}\n\nThis reads well.\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/review/Plan.attach/Plan.commentary.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/store/review/Plan.attach/Plan.commentary.card"),
      errors: [],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 0,
  });

});

// ## A leftover target field on a commentary card is a warning, not an error
//
// Commentary no longer has `defaultHref`/`defaultRef`/`targets`. A card still
// carrying one (pre-attach drift) loads fine — the key is stripped — and surfaces
// as an unknown-key warning so it gets cleaned off disk.
void test("Commentary no longer has defaultHref/defaultRef/targets.", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/store/review/Stale.commentary.card",
    "---\ntype: commentary\ndefaultHref: \"file:/Users/x/doc.md\"\n---\nbody\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/review/Stale.commentary.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/store/review/Stale.commentary.card"),
      errors: [],
      warnings: [
        { type: "schema", severity: "warning", message: "Unknown frontmatter key \"defaultHref\" — not declared by the commentary schema; it is ignored on load and should be removed" },
      ],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 1,
  });

});

// ## Extfile cards validate their href and stamped version
//
// An extfile card's `href` must be a `file:` URL, and a present `version` must
// carry a `sha256:<hex>` marker (it is compared against the live file's hash). A
// well-formed card lints clean; a non-`file:` href or a malformed `version` is an
// error. Whether the href resolves on this machine is *not* checked here.
void test("An extfile card's href must be a file: URL, and a present version must carry...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/store/review/Good.extfile.card",
    "---\ntype: extfile\nhref: file:/Users/me/src/project/src/foo.ts\nversion: \"sha256:9f3a1c2b git:7ffeae4\"\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/review/Good.extfile.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/store/review/Good.extfile.card"),
      errors: [],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 0,
    totalErrors: 0,
    totalWarnings: 0,
  });

});

// A non-`file:` href is an error:
void test("A non-file: href is an error:", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/store/review/BadHref.extfile.card",
    "---\ntype: extfile\nhref: https://example.com/foo.ts\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/review/BadHref.extfile.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/store/review/BadHref.extfile.card"),
      errors: [
        { type: "validation", severity: "error", message: "extfile href must be a file: URL (got \"https://example.com/foo.ts\")" },
      ],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 1,
    totalWarnings: 0,
  });

});

// A malformed `version` (no `sha256:` marker) is an error:
void test("A malformed version (no sha256: marker) is an error:", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/store/review/BadVer.extfile.card",
    "---\ntype: extfile\nhref: file:/Users/me/src/project/src/foo.ts\nversion: not-a-hash\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/review/BadVer.extfile.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [{
      path: box.path("_content/store/review/BadVer.extfile.card"),
      errors: [
        { type: "validation", severity: "error", message: "extfile version must contain a sha256:<hex> marker (got \"not-a-hash\")" },
      ],
      warnings: [],
    }],
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 1,
    totalWarnings: 0,
  });

});

// ## A schema's `validate` hook is dispatched generically by type
//
// card-lint no longer hardcodes which types get extra validation — it calls
// `schema.validate` for whatever type the card declares. The `gadget` schema
// (setup) errors when `mode: forbidden`; a card that trips it surfaces the hook's
// message, and a card that doesn't lints clean.
void test("card-lint no longer hardcodes which types get extra validation — it calls sch...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/store/Bad.gadget.card",
    "---\ntype: gadget\nmode: forbidden\n---\n",
  );
  await box.write(
    "_content/store/Ok.gadget.card",
    "---\ntype: gadget\nmode: allowed\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/Bad.gadget.card"), box.path("_content/store/Ok.gadget.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, {
    results: [
      {
        path: box.path("_content/store/Bad.gadget.card"),
        errors: [{ type: "validation", severity: "error", message: "gadget mode must not be \"forbidden\"" }],
        warnings: [],
      },
      { path: box.path("_content/store/Ok.gadget.card"), errors: [], warnings: [] },
    ],
    filesChecked: 2,
    filesWithErrors: 1,
    totalErrors: 1,
    totalWarnings: 0,
  });

});
