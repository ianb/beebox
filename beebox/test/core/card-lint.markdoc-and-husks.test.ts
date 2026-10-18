// # card-lint: Markdoc validation, path fields, and chat husks
//
// Continues [card-lint.doctest.md](card-lint.doctest.md). This part covers universal Markdoc body validation, non-`ref` path fields, media and chat husk fields, absolute machine paths, and type-scoped Markdoc tags.

import { test } from "tap";
import "agent-doctest/tap";
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

// ## Universal Markdoc body validation: an invalid `{% todo %}` status warns
//
// Every card with a markdown body is now parsed and run through
// `Markdoc.validate` against the shared vocabulary (`docs/plans/
// todo-annotation.md`, Track 1 chunk 2) — not just commentary. A `status`
// value outside the enum is a **warning** (this new pass is warning-first
// until an existing-box survey justifies flipping it to error), naming the
// line, the tag, and the Markdoc message:
void test("Every card with a markdown body is now parsed and run through Markdoc.validat...", async (t) => {
  // doctest:L75
  const box = await makeTmpBox();
  await box.write(
    "_content/store/notes/Plan.doc.card",
    "---\ntype: doc\ntitle: Plan\n---\n{% todo status=\"Done\" %}Ship the thing{% /todo %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/notes/Plan.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result.totalErrors, 0);

  // doctest:L87
  t.check(result.totalWarnings, 1);

  // doctest:L90
  t.check(result.results[0]!.warnings[0]!.message, "Markdoc body issue at line 1 (todo): Attribute 'status' must match one of [\"open\",\"done\",\"dropped\",\"parked\"]. Got 'Done' instead.");
});

// The same attribution holds for a **multi-line block** `{% todo %}` (opening
// tag, body text, closing tag on separate lines) — Markdoc's `ValidateError.lines`
// for a block tag is a 4-element span (`[open, ..., ..., close]`), whose LAST
// element must match a tag span's end line, not its second element (a
// regression: `collectTagSpans` used to record `lines[1]` as the end, which is
// only correct for a one-line span, so a multi-line block tag's error fell back
// to attribution `(body)` and the collector below never flagged the card):
void test("The same attribution holds for a multi-line block {% todo %} (opening tag, bo...", async (t) => {
  // doctest:L103
  const box = await makeTmpBox();
  await box.write(
    "_content/store/notes/Multiline.doc.card",
    '---\ntype: doc\ntitle: Plan\n---\n{% todo status="Done" %}\nShip the thing\n{% /todo %}\n',
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/notes/Multiline.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result.totalWarnings, 1);

  // doctest:L115
  t.check(result.results[0]!.warnings[0]!.message, "Markdoc body issue at line 1 (todo): Attribute 'status' must match one of [\"open\",\"done\",\"dropped\",\"parked\"]. Got 'Done' instead.");
});

// A body with a valid `{% todo %}` (or no tags at all) lints clean:
void test("A body with a valid {% todo %} (or no tags at all) lints clean:", async (t) => {
  // doctest:L122
  const box = await makeTmpBox();
  await box.write(
    "_content/store/notes/Plan2.doc.card",
    "---\ntype: doc\ntitle: Plan\n---\n{% todo id=\"ship-it\" due=\"2026-08-01\" %}Ship the thing{% /todo %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/notes/Plan2.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result.totalWarnings, 0);
});

// ## Universal Markdoc body validation: a body that fails to parse warns, not silently
//
// Malformed tag syntax (an unquoted attribute value that breaks Markdoc's own
// tag grammar) doesn't hide the card's todos — it's reported as a warning
// naming the parse failure, never swallowed (the opposite posture from
// `body-refs.ts`'s ref walker, which is fine losing a few ref warnings to a
// rare parse failure precisely because this pass is the backstop that still
// reports it):
void test("Malformed tag syntax (an unquoted attribute value that breaks Markdoc's own t...", async (t) => {
  // doctest:L145
  const box = await makeTmpBox();
  await box.write(
    "_content/store/notes/Broken.doc.card",
    "---\ntype: doc\ntitle: Broken\n---\n{% todo status=oops %}Ship the thing{%/todo%}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/notes/Broken.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result.totalErrors, 0);

  // doctest:L157
  await t.checkText(result.totalWarnings > 0, "true");

  // doctest:L160
  await t.checkText(result.results[0]!.warnings.some(w => w.message.includes("Markdoc body issue")), "true");
});

// ## Commentary cards don't double-report Markdoc violations
//
// Commentary already runs `Markdoc.validate` on its body at **error**
// severity, via its own schema `validate` hook (`ownMarkdocValidation: true`
// tells the generic pass to skip it). A commentary body that violates the
// shared vocabulary (here, `{% source %}`'s ref-xor-href rule) is reported
// exactly once — as the schema's own error — not again as a generic warning:
void test("Commentary already runs Markdoc.validate on its body at error severity, via i...", async (t) => {
  // doctest:L173
  const box = await makeTmpBox();
  await box.write("_content/store/review/a.doc.card", "---\ntype: doc\ntitle: A\n---\nA.\n");
  await box.write(
    "_content/store/review/Dup.attach/Dup.commentary.card",
    "---\ntype: commentary\n---\n{% source ref=\"../a.doc.card\" href=\"https://example.com\" %}both{% /source %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/review/Dup.attach/Dup.commentary.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result.totalErrors, 1);

  // doctest:L186
  t.check(result.totalWarnings, 1);

  // doctest:L189
  await t.checkText(result.results[0]!.errors[0]!.message, "{% source %} takes at most one of `ref` or `href`, not both");

  // The one warning is the relative-ref deprecation notice (Track B) — the
  // `{% source %}` tag's `ref="../a.doc.card"` is a document-relative body ref,
  // which now warns by default alongside the `ref`/`href` error:

  // doctest:L198
  t.check(result.results[0]!.warnings[0]!.message, "Non-canonical ref at body:1:source.ref: ../a.doc.card → /_content/store/review/a.doc.card");
});

// ## Path fields not named `ref` are checked too (`symbol.src`, `entry`)
//
// The generic broken-ref walk keys on frontmatter keys literally named
// `ref`/`refs`, which left two real path fields unvalidated: a landmark's
// `symbol.src` (its icon image) and a figure's `entry` (the sketch
// source in the card's attach scope). Both are now resolved through the same
// 3-form semantics and reported as `type: "reference"` warnings when they name
// nothing — a missing icon or an uncompilable figure is visible at validate
// time instead of at render time.
void test("The generic broken-ref walk keys on frontmatter keys literally named ref/refs...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L213
  const box = await makeTmpBox();
  await box.write("_content/recipes/images/portrait.webp", "WEBP");
  await box.write(
    "_content/recipes/Recipes.landmark.card",
    "---\nnavigation:\n  label: Recipes\nsymbol:\n  src: /_content/recipes/images/portrait.webp\n---\n",
  );
  await box.write(
    "_content/recipes/Gone.landmark.card",
    "---\nnavigation:\n  label: Gone\nsymbol:\n  src: images/vanished.webp\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/recipes/Recipes.landmark.card"), box.path("_content/recipes/Gone.landmark.card")],
    { boxRoot: box.root, ctx },
  );
  t.check([result.totalErrors, result.totalWarnings], [
    0,
    1,
  ]);

  // doctest:L230
  t.check(result.results[1]!.warnings[0]!.type, "reference");

  // doctest:L233
  t.check(result.results[1]!.warnings[0]!.message, "Broken reference at symbol.src: images/vanished.webp does not exist");

  // A text/emoji symbol has no path to check, and a figure's `entry` resolves in
  // the card's own attach scope:

  // doctest:L241
  await box.write("_content/store/figures/Orbit.attach/sketch.ts", "export default () => {};\n");
  await box.write(
    "_content/store/figures/Orbit.figure.card",
    "---\nruntime: p5js\nentry: attach/sketch.ts\n---\nAn orbit.\n",
  );
  await box.write(
    "_content/store/figures/Dangling.figure.card",
    "---\nruntime: p5js\nentry: attach/missing.ts\n---\nNothing behind it.\n",
  );
  await box.write(
    "_content/recipes/Emoji.landmark.card",
    "---\nnavigation:\n  label: Recipes\nsymbol:\n  glyph: 🍳\n---\n",
  );
  const figures = await lintCardsDispatch(
    [
      box.path("_content/store/figures/Orbit.figure.card"),
      box.path("_content/store/figures/Dangling.figure.card"),
      box.path("_content/recipes/Emoji.landmark.card"),
    ],
    { boxRoot: box.root, ctx },
  );
  t.check([figures.totalErrors, figures.totalWarnings], [
    0,
    1,
  ]);

  // doctest:L265
  t.check(figures.results[1]!.warnings[0]!.message, "Broken reference at entry: attach/missing.ts does not exist");
});

// ## Media cards: `filename.ref` must be in `attach/` form
//
// An `image`, `audio`, `file` or `pdf` card keeps its file in its attach scope,
// and every reader of `filename.ref` accepts only `attach/<file>`. A legacy
// flat-layout ref resolves, so the broken-ref walk is silent; this warning names
// the move that fixes it.
void test("An image, audio, file or pdf card keeps its file in its attach scope, and eve...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L281
  const box = await makeTmpBox();
  await box.write("_content/cap/photo-004.jpg", "JPG");
  await box.write(
    "_content/cap/photo-004-Beach.image.card",
    "---\nfilename:\n  ref: /_content/cap/photo-004.jpg\n  via:\n    channel: scan\n    at: 2026-01-02T03:04:05Z\n---\n",
  );
  const media = await lintCardsDispatch([box.path("_content/cap/photo-004-Beach.image.card")], { boxRoot: box.root, ctx });
  t.check(media.results[0]!.warnings.map((w) => w.message), [
    "filename.ref must point into the card's attach scope: move photo-004.jpg into photo-004-Beach.attach/ and write `ref: attach/photo-004.jpg` (found `/_content/cap/photo-004.jpg`)",
  ]);
});

// ## Chat husks: `session` must be a real engine session id
//
// A husk's `session` field is the *only* thing that identifies which chat the
// card is about — the filename is a naming convention, and renaming a husk is
// encouraged (`docs/implemented-plans/chat-session-identity.md`). So it is validated as a
// UUID before anything keys on it or joins it into a path: Claude Agent SDK ids
// are UUIDv4, Codex thread ids UUIDv7, and one check covers both.
void test("A husk's session field is the only thing that identifies which chat the card...", async (t) => {
  // doctest:L308
  const box = await makeTmpBox();
  await box.write("_content/chat/web/2026-08-26_ok.chat.card",
    "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
  await box.write("_content/chat/web/2026-08-26_bad.chat.card",
    "---\nsession: sess1234\n---\n");
  const result = await lintCardsDispatch(
    [box.path("_content/chat/web/2026-08-26_ok.chat.card"), box.path("_content/chat/web/2026-08-26_bad.chat.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(
    {
      ok: result.results[0]!.errors.length,
      bad: result.results[1]!.errors.length,
      says: result.results[1]!.errors[0]!.message.includes("session"),
    },
    {
    ok: 0,
    bad: 1,
    says: true,
  },
  );
});

// ## Chat husks: two cards must never claim one chat
//
// The `session` field is the husk's identity, so a second card carrying it means
// two husks for one conversation — both appear in the picker, and chat review
// would extend two separate accounts from the same transcript. This is card-lint's
// only cross-file rule: the `_content/chat/**` index is built once per
// `lintCardsDispatch` run and memoized on that run's options, not rescanned per
// card. Repair is editorial — which title and body do you keep? — so the rule
// names both paths and stops there.
void test("The session field is the husk's identity, so a second card carrying it means...", async (t) => {
  // doctest:L336
  const box = await makeTmpBox();
  await box.write("_content/chat/web/2026-08-26_59fc20dd.chat.card",
    "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\ntitle: The Acme mess\n---\n");
  await box.write("_content/chat/web/Copied.chat.card",
    "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
  await box.write("_content/chat/web/2026-08-26_aaaa9999.chat.card",
    "---\nsession: aaaa9999-fe6d-45cb-8f37-f1508a5a0869\n---\n");
  const result = await lintCardsDispatch(
    [
      box.path("_content/chat/web/2026-08-26_59fc20dd.chat.card"),
      box.path("_content/chat/web/Copied.chat.card"),
      box.path("_content/chat/web/2026-08-26_aaaa9999.chat.card"),
    ],
    { boxRoot: box.root, ctx },
  );
  t.check({ errors: result.totalErrors, unique: result.results[2]!.errors.length }, {
    errors: 2,
    unique: 0,
  });

  // doctest:L354
  t.check(result.results[0]!.errors[0]!.message, "Duplicate chat session 59fc20dd-fe6d-45cb-8f37-f1508a5a0869: _content/chat/web/2026-08-26_59fc20dd.chat.card and _content/chat/web/Copied.chat.card are husks for one chat. Keep whichever card you want the chat to be, and `bbx trash` the other.");

  // A husk filed outside `_content/chat/web/` counts too — the index walks the whole
  // `_content/chat/**` tree, so moving one of the pair out of the picker's directory
  // doesn't make the collision go away.

  // doctest:L363
  const box2 = await makeTmpBox();
  await box2.write("_content/chat/web/2026-08-26_59fc20dd.chat.card",
    "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
  await box2.write("_content/chat/archive/2026-01-01_59fc20dd.chat.card",
    "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
  const moved = await lintCardsDispatch(
    [box2.path("_content/chat/web/2026-08-26_59fc20dd.chat.card")],
    { boxRoot: box2.root, ctx },
  );
  await t.checkText(moved.results[0]!.errors[0]!.message.includes("_content/chat/archive/2026-01-01_59fc20dd.chat.card"), "true");
});

// ## No absolute machine paths (Track B)
//
// A card whose content embeds a real developer home directory is an ERROR, not
// a warning — a leak, not routine data drift:
void test("A card whose content embeds a real developer home directory is an ERROR, not...", async (t) => {
  // doctest:L382
  const box3 = await makeTmpBox();
  await box3.write(
    "_content/store/notes/Leak.doc.card",
    "---\ntype: doc\ntitle: Leak\n---\nSee /Users/beebox/src/boxes/test1/content for the fixture.\n",
  );
  const leaked = await lintCardsDispatch([box3.path("_content/store/notes/Leak.doc.card")], { boxRoot: box3.root, ctx });
  t.check([leaked.totalErrors, leaked.totalWarnings], [
    1,
    0,
  ]);

  // doctest:L391
  t.check(leaked.results[0]!.errors[0]!.message, "Absolute machine path in card content: /Users/beebox/ — use a box ref (leading `/`) or a repo-relative form, never a real machine path");

  // An extfile card is the one shape whose `href` is REQUIRED to be a `file:` URL,
  // so its absolute machine path is the card's purpose. Scanning it made every real
  // extfile card unfixably invalid — the schema demanded exactly what the leak guard
  // rejected. The href is exempt; a leak anywhere else in the same card still errors:

  // doctest:L401
  const box5 = await makeTmpBox();
  await box5.write(
    "_content/store/review/Live.extfile.card",
    "---\ntype: extfile\nhref: file:/Users/beebox/src/project/src/foo.ts\ntitle: live source\nversion: \"sha256:9f3a1c2b git:7ffeae4\"\n---\n",
  );
  await box5.write(
    "_content/store/review/Both.extfile.card",
    "---\ntype: extfile\nhref: file:/Users/beebox/src/project/src/foo.ts\ntitle: also mentions /Users/beebox/src/elsewhere\nversion: \"sha256:9f3a1c2b git:7ffeae4\"\n---\n",
  );
  const ext = await lintCardsDispatch(
    [box5.path("_content/store/review/Live.extfile.card"), box5.path("_content/store/review/Both.extfile.card")],
    { boxRoot: box5.root, ctx },
  );
  t.check([ext.results[0]!.errors.length, ext.results[1]!.errors.length], [
    0,
    1,
  ]);

  // The `/Users/me`/`/Users/you` placeholder forms (used in `file:` URL examples)
  // are not flagged:

  // doctest:L422
  const box4 = await makeTmpBox();
  await box4.write(
    "_content/store/notes/Fine.doc.card",
    "---\ntype: doc\ntitle: Fine\n---\nOpen file:///Users/me/Desktop/scan.pdf.\n",
  );
  const fine = await lintCardsDispatch([box4.path("_content/store/notes/Fine.doc.card")], { boxRoot: box4.root, ctx });
  t.check(fine.totalErrors, 0);
});

// ## A type's scoped Markdoc tags validate in that type's cards only
//
// A schema's `markdocTags` extend the core table for cards of that type. The
// same tag in a card of another type is still `Undefined tag`.
void test("A schema's markdocTags extend the core table for cards of that type.", async (t) => {
  // doctest:L438
  const dishSchema: CardSchema = cardSchema("dish", {
    fields: { title: z.string(), body: body(z.string()) },
    markdocTags: { garnish: { render: "Garnish", attributes: { amount: { type: String } } } },
  });
  const scopedCtx: LoadCardContext = {
    cardSchemas: new Map<string, CardSchema>([["dish", dishSchema], ["doc", docSchema]]),
  };
  const scopedBox = await makeTmpBox();
  await scopedBox.write(
    "_content/box/Soup.dish.card",
    "---\ntype: dish\ntitle: Soup\n---\nAdd {% garnish amount=\"2\" %}parsley{% /garnish %}.\n",
  );
  await scopedBox.write(
    "_content/box/Notes.doc.card",
    "---\ntype: doc\ntitle: Notes\n---\nAdd {% garnish amount=\"2\" %}parsley{% /garnish %}.\n",
  );
  const scopedResult = await lintCardsDispatch(
    [scopedBox.path("_content/box/Soup.dish.card"), scopedBox.path("_content/box/Notes.doc.card")],
    { boxRoot: scopedBox.root, ctx: scopedCtx },
  );
  t.check(scopedResult.results.map((r) => r.warnings.filter((w) => w.message.includes("Undefined tag")).length), [
    0,
    1,
  ]);
});

// ## The retired type-specific tags are undefined everywhere
//
// `purpose`, `correction`, `image`, and `silence` were core tags owned by one
// card type each (briefing, capture-session). The `body-tags-2026-10` migration
// rewrote them into frontmatter, a section, a link, and plain text, and the
// table no longer has them, so each is reported as an undefined tag in any card.
void test("purpose, correction, image, and silence were core tags owned by one card type...", async (t) => {
  // doctest:L470
  const retiredBox = await makeTmpBox();
  await retiredBox.write(
    "_content/box/Old.doc.card",
    "---\ntype: doc\ntitle: Old\n---\n{% purpose %}\nP\n{% /purpose %}\n\n{% correction %}\nC\n{% /correction %}\n\n{% image ref=\"attach/a.image.card\" /%}\n\n{% silence duration=\"9s\" /%}\n",
  );
  const retired = await lintCardsDispatch([retiredBox.path("_content/box/Old.doc.card")], { boxRoot: retiredBox.root, ctx });
  t.check(retired.results[0]?.warnings.filter((w) => w.message.includes("Undefined tag")).map((w) => w.message.match(/'([a-z]+)'/)?.[1]), [
    "purpose",
    "correction",
    "image",
    "silence",
  ]);
});
