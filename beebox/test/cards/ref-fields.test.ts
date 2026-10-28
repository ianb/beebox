// # Ref fields: cardRef vs opaqueContentRef
//
// `cardRef()` and `opaqueContentRef()` are the two ref-field constructors. Both
// produce the same on-disk shape (`{ ref: string }`); they differ only in whether
// `collectInlineRefs` will auto-inline the target into an agent prompt. A card ref
// is inline-safe (box metadata); an opaque content ref is never auto-inlined (raw
// external bytes). An un-migrated bare `z.object({ ref: z.string() })` defaults to
// inline — the pre-distinction behaviour.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not, str } from "@ianbicking/tap-check/check";
import { z } from "zod";
import { cardSchema, cardRef, opaqueContentRef, collectInlineRefs } from "../../src/exports/cards.js";
import { describeJob } from "../../src/core/reactor/engine/batch-jobs.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## describeJob does not inline an opaque ref, but does inline a cardRef
//
// The end-to-end prompt boundary. A job schema with both an inline item and an
// opaque body ref: the item card's text appears in the built job description; the
// opaque body's bytes never do. This is the closest feasible equivalent of the
// plan's before/after prompt diff — the exact prompt text is asserted below.

// ## cardRef is collected; opaqueContentRef is skipped
//
// A schema whose frontmatter carries one of each: only the cardRef is returned.
void test("A schema whose frontmatter carries one of each:", async (t) => {
  const schema = cardSchema("demo-job", {
    fields: {
      item: cardRef(),
      "body-file": opaqueContentRef(),
    },
  }).frontmatterSchema;

  const fields = {
    type: "demo-job",
    item: { ref: "store/inbox/a.doc.card" },
    "body-file": { ref: "store/mail/msg.attach/body.txt" },
  };

  t.check(collectInlineRefs(schema, fields), [
    "store/inbox/a.doc.card",
  ]);
});

// ## A bare (un-migrated) ref field still inlines by default
void test("A bare (un-migrated) ref field still inlines by default", async (t) => {
  const schema = cardSchema("legacy-job", {
    fields: { thread: z.object({ ref: z.string() }) },
  }).frontmatterSchema;

  t.check(collectInlineRefs(schema, { type: "legacy-job", thread: { ref: "store/threads/t.card" } }), [
    "store/threads/t.card",
  ]);
});

// ## Refs are collected through arrays and optional wrappers
//
// An array of cardRefs yields each ref in order; an optional opaque ref stays
// skipped even when present.
void test("An array of cardRefs yields each ref in order; an optional opaque ref stays s...", async (t) => {
  const schema = cardSchema("multi-job", {
    fields: {
      items: z.array(cardRef()),
      "body-file": opaqueContentRef().optional(),
    },
  }).frontmatterSchema;

  const fields = {
    type: "multi-job",
    items: [{ ref: "a.card" }, { ref: "b.card" }],
    "body-file": { ref: "raw.txt" },
  };

  t.check(collectInlineRefs(schema, fields), [
    "a.card",
    "b.card",
  ]);
});

// ## Refs inside a union are collected (and not double-counted)
//
// A ref field typed as `cardRef() | z.object({ href })` still inlines the ref when
// the value is the ref arm; the non-ref arm no-ops rather than duplicating it.
void test("A ref field typed as cardRef() | z.object({ href }) still inlines the ref whe...", async (t) => {
  const schema = cardSchema("union-job", {
    fields: { target: z.union([cardRef(), z.object({ href: z.string() })]) },
  }).frontmatterSchema;

  t.check(collectInlineRefs(schema, { type: "union-job", target: { ref: "a.card" } }), [
    "a.card",
  ]);

  t.check(
    collectInlineRefs(schema, { type: "union-job", target: { href: "https://x" } })
    ,
    [],
  );
});

// ## An opaque ref inside a union stays skipped (fail-closed)
void test("An opaque ref inside a union stays skipped (fail-closed)", async (t) => {
  const schema = cardSchema("uopaque-job", {
    fields: { target: z.union([opaqueContentRef(), z.object({ href: z.string() })]) },
  }).frontmatterSchema;

  t.check(collectInlineRefs(schema, { type: "uopaque-job", target: { ref: "raw.txt" } }), []);
});

// `intake-job` items are `cardRef`s (inline), so a real intake job inlines its
// referenced item card verbatim, fenced:
void test("intake-job items are cardRefs (inline), so a real intake job inlines its refe...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write("store/inbox/item.doc.card", "---\ntitle: Note\n---\nSAFE METADATA BODY");
  await box.write(
    "box/jobs/x.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: rss\npriority: normal\ndescription: Triage one item\nitems:\n  - ref: store/inbox/item.doc.card\n---\n",
  );
  const content = await box.read("box/jobs/x.intake.job.card");

  const desc = (await describeJob(
    { card: { file: "x.intake.job.card", priority: "normal", createdAt: null }, relPath: "box/jobs/x.intake.job.card", content },
    box.root,
  )).full;

  // The job body and the inlined cardRef target (verbatim, in its own fenced section) come first;
  // the schema instructions that follow are a large generated text, left to the doc's own tests.
  t.check(desc, str`### box/jobs/x.intake.job.card
\`\`\`
---
status: pending
created: 2026-07-01T00:00:00Z
source: rss
priority: normal
description: Triage one item
items:
  - ref: store/inbox/item.doc.card
---
\`\`\`

#### store/inbox/item.doc.card
\`\`\`
---
title: Note
---
SAFE METADATA BODY
\`\`\`

#### Instructions for intake-job
${any(String)}`);

  await box.cleanup();
});

// ## Exact prompt text: the job body is plainly fenced
//
// The whole point of the fence migration made visible — the job card's own content
// opens with a bare three-backtick fence (no `xml` label), and the schema
// instructions follow. Asserting the exact leading text keeps the fence change
// reviewed rather than silent.
void test("The whole point of the fence migration made visible — the job card's own cont...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write(
    "box/jobs/z.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: rss\npriority: low\ndescription: Nothing to inline\nitems: []\n---\n",
  );
  const content = await box.read("box/jobs/z.intake.job.card");

  const desc = (await describeJob(
    { card: { file: "z.intake.job.card", priority: "low", createdAt: null }, relPath: "box/jobs/z.intake.job.card", content },
    box.root,
  )).full;

  // The job body sits in a plain 3-backtick fence (no xml label), with no inlined ref
  // sections; the schema instructions that follow are a large generated text.
  t.check(desc, str`### box/jobs/z.intake.job.card *(low priority)*
\`\`\`
---
status: pending
created: 2026-07-01T00:00:00Z
source: rss
priority: low
description: Nothing to inline
items: []
---
\`\`\`

#### Instructions for intake-job
${any(String)}`);
  t.check(desc, not(any(String).includes("```xml")));

  await box.cleanup();
});

// ## Content with a backtick run gets a longer fence, not an early break-out
//
// A referenced card whose body contains its own ``` fence is wrapped in a
// four-backtick fence so the inner run cannot close the section.
void test("A referenced card whose body contains its own  fence is wrapped in a four-bac...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write("store/inbox/tricky.doc.card", "---\ntitle: Note\n---\ntext\n```\nfenced inner\n```\nmore");
  await box.write(
    "box/jobs/y.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: rss\npriority: normal\ndescription: Triage tricky\nitems:\n  - ref: store/inbox/tricky.doc.card\n---\n",
  );
  const content = await box.read("box/jobs/y.intake.job.card");

  const desc = (await describeJob(
    { card: { file: "y.intake.job.card", priority: "normal", createdAt: null }, relPath: "box/jobs/y.intake.job.card", content },
    box.root,
  )).full;

  // The inlined ref (its whole file, frontmatter included) sits inside a four-backtick
  // fence, so the body's own fence cannot close it early. The schema instructions that
  // follow are a large generated text.
  t.check(desc, str`### box/jobs/y.intake.job.card
\`\`\`
---
status: pending
created: 2026-07-01T00:00:00Z
source: rss
priority: normal
description: Triage tricky
items:
  - ref: store/inbox/tricky.doc.card
---
\`\`\`

#### store/inbox/tricky.doc.card
\`\`\`\`
---
title: Note
---
text
\`\`\`
fenced inner
\`\`\`
more
\`\`\`\`

#### Instructions for intake-job
${any(String)}`);

  await box.cleanup();
});
