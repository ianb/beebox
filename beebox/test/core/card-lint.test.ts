// # card-lint: validating frontmatter cards
//
// `lintCardsDispatch` is the validate-time counterpart to
// `loadCardFile`: it picks the right validator for each file based on
// its frontmatter, then merges results into a single LintSummary.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { z } from "zod";
import {
  body,
  cardSchema,
  formatLintResults,
  type CardSchema,
  type LintResult,
} from "../../src/exports/cards.js";
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

type Issue = LintResult["errors"][number];
const warn = (type: Issue["type"], message: string): Issue => ({ type, severity: "warning", message });
const error = (type: Issue["type"], message: string): Issue => ({ type, severity: "error", message });
/** The result and summary for a run that linted only `path`, with its issues split by severity. */
function one(path: string, ...issues: Issue[]) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return {
    results: [{ path, errors, warnings }],
    filesChecked: 1,
    filesWithErrors: errors.length > 0 ? 1 : 0,
    totalErrors: errors.length,
    totalWarnings: warnings.length,
  };
}

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

// ## Frontmatter cards that satisfy their schema lint clean
void test("Frontmatter cards that satisfy their schema lint clean", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/email/thread-x.email-thread.card",
    "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread-x.attach/msg-001.email-message.card\n---\n",
  );
  await box.write(
    "_content/inbox/email/thread-x.attach/msg-001.email-message.card",
    "---\nmessage-id: m1\nthread-id: t1\nfrom: a@x\ndate: 2026-02-15T10:00:00Z\nsubject: hi\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/email/thread-x.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, one(`${box.root}/_content/inbox/email/thread-x.email-thread.card`));
});

// ## Schema violations in frontmatter cards surface as lint errors
void test("Schema violations in frontmatter cards surface as lint errors", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/email/broken.email-thread.card",
    "---\ntype: email-thread\nthread-id: t1\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/email/broken.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, one(`${box.root}/_content/inbox/email/broken.email-thread.card`, error("validation", "invalid email-thread frontmatter:\n  - subject: required (expected string)\n  - participants: required (expected array)\n  - date-range: required (expected object)\n  - messages: required (expected array)")));
});

// ## Unknown frontmatter keys are reported as warnings
//
// A key the schema doesn't declare is stripped on load, so the card still loads,
// renders, and indexes. Lint surfaces it as a warning (not an error) so it gets
// cleaned off disk eventually without blocking commits.
void test("A key the schema doesn't declare is stripped on load, so the card still loads...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/notes/drift.doc.card",
    "---\ntype: doc\ntitle: Drift\nbogus-field: oops\n---\nBody.\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/notes/drift.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, one(`${box.root}/_content/inbox/notes/drift.doc.card`, warn("schema", "Unknown frontmatter key \"bogus-field\" — not declared by the doc schema; it is ignored on load and should be removed")));
});

// ## Broken refs in frontmatter cards are reported as warnings
//
// Each entry in a ref-declared field is resolved against the box; missing
// targets surface as lint warnings (not errors) carrying the field path. Broken
// refs are warnings because they commonly arise from legitimate operations
// (referents being moved, archived, trashed, or hand-deleted), and treating
// each as a hard error would block commits on any box with accumulated drift.
void test("Each entry in a ref-declared field is resolved against the box; missing targe...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/email/thread-x/thread.email-thread.card",
    "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/email/thread-x/thread.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(
    result,
    one(`${box.root}/_content/inbox/email/thread-x/thread.email-thread.card`,
      warn("reference", "Broken reference at messages[0].ref: thread.attach/missing.email-message.card does not exist"),
  ));
});

// ## A URL in a ref field is named as a URL, not as a missing file
//
// A `ref` names a path inside the box. Probing a URL as a file produced the least
// useful sentence the linter can say — "https://… does not exist" sends the reader
// looking for a file nobody meant to write.
void test("A ref names a path inside the box.", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/email/thread-y/thread.email-thread.card",
    "---\ntype: email-thread\nthread-id: t2\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: https://example.com/thread/1\n---\n",
  );
  const urlRef = await lintCardsDispatch(
    [box.path("_content/inbox/email/thread-y/thread.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(
    urlRef,
    one(`${box.root}/_content/inbox/email/thread-y/thread.email-thread.card`,
      warn("reference", "External URL at messages[0].ref: https://example.com/thread/1 — a ref names an in-box path; a URL belongs in an `href` field"),
  ));

  // A bare `#anchor` and an empty ref are NOT swept in with it: both name something
  // in-box (or missing), and the existence walk already describes them correctly.

  await box.write(
    "_content/inbox/email/thread-z/thread.email-thread.card",
    "---\ntype: email-thread\nthread-id: t3\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: \"#exp4\"\n---\n",
  );
  const anchorRef = await lintCardsDispatch(
    [box.path("_content/inbox/email/thread-z/thread.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(anchorRef, one(`${box.root}/_content/inbox/email/thread-z/thread.email-thread.card`, warn("reference", "Broken reference at messages[0].ref: #exp4 does not exist")));

  await box.cleanup();
});

// ## A display-form path in a frontmatter ref is a lint ERROR naming the canonical form
//
// `Config:box.json` (the boxholder's CONVERSATION vocabulary — never a
// canonical path) written into a `ref:`/`refs:` field is a lint ERROR, not a
// broken-ref warning: the message names the canonical form so the fix is
// obvious (`docs/plans/display-path-guard.subplan.md`).
void test("Config:box.json (the boxholder's CONVERSATION vocabulary — never a canonical...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/email/thread-x/thread.email-thread.card",
    "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: Config:box.json\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/email/thread-x/thread.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(
    result,
    one(
      `${box.root}/_content/inbox/email/thread-x/thread.email-thread.card`,
      error("display-path", "Display-form path at messages[0].ref: `Config:box.json` is the boxholder's display form; write `/_config/box.json`"),
    ),
  );
});

// ## A broken bare ref suggests `/_content/<path>` when that resolves
//
// A ref's bare form is DOCUMENT-relative, not box-root-relative — but a
// boxholder's bare display vocabulary (`recipes/Soup.recipe.card`) reads as
// content-root-relative, so a ref hand-typed that way can silently mean the
// wrong thing and break. When the ordinary resolution fails, the broken-ref
// message probes `/_content/<path>` and appends a suggestion when THAT
// resolves (`docs/plans/display-path-guard.subplan.md`):
void test("A ref's bare form is DOCUMENT-relative, not box-root-relative — but a boxhold...", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/recipes/Soup.recipe.card", "---\ntype: doc\ntitle: Soup\n---\n");
  await box.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"recipes/Soup.recipe.card\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(
    result,
    one(`${box.root}/_content/box/notes/Meeting.doc.card`,
      warn("canonical", "Non-canonical ref at body:1:source.ref: recipes/Soup.recipe.card → /_content/box/notes/recipes/Soup.recipe.card"),
      warn("reference", "Broken reference at body:1:source.ref: recipes/Soup.recipe.card does not exist — did you mean `/_content/recipes/Soup.recipe.card`?"),
  ));
});

// No suggestion is offered when `/_content/<path>` doesn't resolve either — the
// plain "does not exist" message is unchanged:
void test("No suggestion is offered when /content/<path> doesn't resolve either — the pl...", async (t) => {
  const box2 = await makeTmpBox();
  await box2.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"nowhere/at/all.card\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const result2 = await lintCardsDispatch(
    [box2.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: box2.root, ctx },
  );
  t.check(
    result2,
    one(`${box2.root}/_content/box/notes/Meeting.doc.card`,
      warn("canonical", "Non-canonical ref at body:1:source.ref: nowhere/at/all.card → /_content/box/notes/nowhere/at/all.card"),
      warn("reference", "Broken reference at body:1:source.ref: nowhere/at/all.card does not exist"),
  ));
});

// A ref the box namespace fence refuses says so instead. A package doc exists on
// disk under `node_modules/`, but no ref can reach it, and "does not exist" would
// send the author looking for a missing file:
void test("A ref the box namespace fence refuses says so instead.", async (t) => {
  const boxFence = await makeTmpBox();
  await boxFence.write("node_modules/beebox/box-docs/card-doc.md", "# doc\n");
  await boxFence.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"/node_modules/beebox/box-docs/card-doc.md\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const resultFence = await lintCardsDispatch(
    [boxFence.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: boxFence.root, ctx },
  );
  t.check(
    resultFence,
    one(`${boxFence.root}/_content/box/notes/Meeting.doc.card`,
      warn("reference", "Broken reference at body:1:source.ref: /node_modules/beebox/box-docs/card-doc.md points outside the box — a ref reaches only the box's areas (`_content`, `_config`, `_bookkeeping`, `_publish`, `_tmp`); package docs under `node_modules/` can't be linked, so name them in plain text"),
  ));
});

// An `attach/…` ref never gets the content-form suggestion — it's a legitimate,
// different relative form, not the display vocabulary:
void test("An attach/… ref never gets the content-form suggestion — it's a legitimate, d...", async (t) => {
  const box3 = await makeTmpBox();
  await box3.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"attach/missing.pdf\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const result3 = await lintCardsDispatch(
    [box3.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: box3.root, ctx },
  );
  t.check(
    result3,
    one(`${box3.root}/_content/box/notes/Meeting.doc.card`,
      warn("reference", "Broken reference at body:1:source.ref: attach/missing.pdf does not exist"),
  ));
});

// ## A ref's `#fragment` addresses a spot inside the target, not another file
//
// `feedback.target.ref` is documented as `path#fragment`. The fragment (and a
// `?query`) is split off before the existence check — the file either exists or
// it doesn't, regardless of which spot inside it the ref points at. Handing the
// whole string to the filesystem used to report these documented refs as broken.
void test("feedback.target.ref is documented as path#fragment.", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/box/notes/Plan.doc.card", "---\ntype: doc\ntitle: Plan\n---\nBody.\n");
  await box.write(
    "_content/box/notes/Meeting.doc.card",
    "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"/_content/box/notes/Plan.doc.card#risks\" usage=\"verbatim\" %}{% /source %}\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/box/notes/Meeting.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(result, one(`${box.root}/_content/box/notes/Meeting.doc.card`));
});

// ## `bbx validate`'s summary line calls out broken refs separately
//
// Broken-reference warnings accumulate silently across renames/deletes and can
// run into the thousands on a drifted box — easy to lose inside a generic
// "N warnings" count. `formatLintResults` breaks them out as their own
// "N broken ref(s)" clause on the aggregate summary line, so they can't hide in
// the noise. Zero broken refs (even alongside other warnings) means no such
// clause is added at all — a clean box gets no new output.
void test("Broken-reference warnings accumulate silently across renames/deletes and can...", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/email/thread-x/thread.email-thread.card",
    "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/email/thread-x/thread.email-thread.card")],
    { boxRoot: box.root, ctx },
  );
  const summary = formatLintResults(result).split("\n").at(-1);
  t.check(summary, "1 file checked, 1 warning in 0 files (1 broken ref)");
});

// A warning that isn't a broken ref (e.g. an unknown frontmatter key) leaves
// the summary's broken-ref clause off entirely:
void test("A warning that isn't a broken ref (e.g.", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/inbox/notes/drift.doc.card",
    "---\ntype: doc\ntitle: Drift\nbogus-field: oops\n---\nBody.\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/inbox/notes/drift.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(formatLintResults(result).split("\n").at(-1), "1 file checked, 1 warning in 0 files");
});

// ## An over-budget `contains:` field warns (never blocks)
//
// `contains` is one concise sentence stating what can be found in the card;
// past 200 characters the writer is summarizing instead. Warning-level so the
// nudge reaches agents (the PostToolUse hook surfaces warnings) without
// blocking commits.
void test("contains is one concise sentence stating what can be found in the card; past...", async (t) => {
  const box = await makeTmpBox();
  const longContains = "x".repeat(220);
  await box.write(
    "_content/store/notes/Wordy.doc.card",
    "---\ntitle: Wordy\ncontains: " + longContains + "\n---\nbody\n",
  );
  const result = await lintCardsDispatch(
    [box.path("_content/store/notes/Wordy.doc.card")],
    { boxRoot: box.root, ctx },
  );
  t.check(
    result,
    one(`${box.root}/_content/store/notes/Wordy.doc.card`,
      warn("contains", "contains: is 220 chars (budget 200) — tighten it to one sentence stating what can be found in this card"),
  ));
});
