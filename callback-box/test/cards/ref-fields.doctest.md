# Ref fields: cardRef vs opaqueContentRef

`cardRef()` and `opaqueContentRef()` are the two ref-field constructors. Both
produce the same on-disk shape (`{ ref: string }`); they differ only in whether
`collectInlineRefs` will auto-inline the target into an agent prompt. A card ref
is inline-safe (box metadata); an opaque content ref is never auto-inlined (raw
external bytes). An un-migrated bare `z.object({ ref: z.string() })` defaults to
inline — the pre-distinction behaviour.

```ts setup
import { z } from "zod";
import { cardSchema, cardRef, opaqueContentRef, collectInlineRefs } from "../../src/cards/index.js";
```

## cardRef is collected; opaqueContentRef is skipped

A schema whose frontmatter carries one of each: only the cardRef is returned.

```ts
const schema = cardSchema("demo-job", {
  fields: {
    item: cardRef(),
    "body-file": opaqueContentRef(),
  },
}).frontmatterSchema;

const fields = {
  type: "demo-job",
  item: { ref: "store/inbox/a.memo.card" },
  "body-file": { ref: "store/mail/msg.attach/body.txt" },
};

JSON.stringify(collectInlineRefs(schema, fields))
=> ["store/inbox/a.memo.card"]
```

## A bare (un-migrated) ref field still inlines by default

```ts
const schema = cardSchema("legacy-job", {
  fields: { thread: z.object({ ref: z.string() }) },
}).frontmatterSchema;

JSON.stringify(collectInlineRefs(schema, { type: "legacy-job", thread: { ref: "store/threads/t.card" } }))
=> ["store/threads/t.card"]
```

## Refs are collected through arrays and optional wrappers

An array of cardRefs yields each ref in order; an optional opaque ref stays
skipped even when present.

```ts
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

JSON.stringify(collectInlineRefs(schema, fields))
=> ["a.card","b.card"]
```

## Refs inside a union are collected (and not double-counted)

A ref field typed as `cardRef() | z.object({ href })` still inlines the ref when
the value is the ref arm; the non-ref arm no-ops rather than duplicating it.

```ts
const schema = cardSchema("union-job", {
  fields: { target: z.union([cardRef(), z.object({ href: z.string() })]) },
}).frontmatterSchema;

JSON.stringify(collectInlineRefs(schema, { type: "union-job", target: { ref: "a.card" } }))
=> ["a.card"]

JSON.stringify(collectInlineRefs(schema, { type: "union-job", target: { href: "https://x" } }))
=> []
```

## An opaque ref inside a union stays skipped (fail-closed)

```ts
const schema = cardSchema("uopaque-job", {
  fields: { target: z.union([opaqueContentRef(), z.object({ href: z.string() })]) },
}).frontmatterSchema;

JSON.stringify(collectInlineRefs(schema, { type: "uopaque-job", target: { ref: "raw.txt" } }))
=> []
```

## buildJobDescription does not inline an opaque ref, but does inline a cardRef

The end-to-end prompt boundary. A job schema with both an inline item and an
opaque body ref: the item card's text appears in the built job description; the
opaque body's bytes never do. This is the closest feasible equivalent of the
plan's before/after prompt diff — the exact prompt text is asserted below.

```ts setup
import { buildJobDescription } from "../../src/core/reactor/batch-jobs.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

`intake-job` items are `cardRef`s (inline), so a real intake job inlines its
referenced item card verbatim, fenced:

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/item.memo.card", `---\nstatus: new\n---\nSAFE METADATA BODY`);
await box.write(
  "box/jobs/x.intake.job.card",
  "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: rss\npriority: normal\ndescription: Triage one item\nitems:\n  - ref: store/inbox/item.memo.card\n---\n",
);
const content = await box.read("box/jobs/x.intake.job.card");

const desc = await buildJobDescription(
  { card: { file: "x.intake.job.card", priority: "normal" }, relPath: "box/jobs/x.intake.job.card", content },
  box.root,
);

// The cardRef target is inlined verbatim, under its own fenced section.
desc.includes("#### store/inbox/item.memo.card")
=> true

desc.includes("SAFE METADATA BODY")
=> true

await box.cleanup();
```

## Exact prompt text: the job body is plainly fenced

The whole point of the fence migration made visible — the job card's own content
opens with a bare three-backtick fence (no `xml` label), and the schema
instructions follow. Asserting the exact leading text keeps the fence change
reviewed rather than silent.

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "box/jobs/z.intake.job.card",
  "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: rss\npriority: low\ndescription: Nothing to inline\nitems: []\n---\n",
);
const content = await box.read("box/jobs/z.intake.job.card");

const desc = await buildJobDescription(
  { card: { file: "z.intake.job.card", priority: "low" }, relPath: "box/jobs/z.intake.job.card", content },
  box.root,
);

// Header + low-priority label, then the job body inside a plain 3-backtick fence.
desc.startsWith("### box/jobs/z.intake.job.card *(low priority)*\n```\n")
=> true

desc.includes("description: Nothing to inline")
=> true

// No inlined ref sections (items is empty) and no misleading ```xml label.
desc.includes("```xml")
=> false

desc.includes("#### ")
=> true

await box.cleanup();
```

## Content with a backtick run gets a longer fence, not an early break-out

A referenced card whose body contains its own ``` fence is wrapped in a
four-backtick fence so the inner run cannot close the section.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/tricky.memo.card", "---\nstatus: new\n---\ntext\n```\nfenced inner\n```\nmore");
await box.write(
  "box/jobs/y.intake.job.card",
  "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: rss\npriority: normal\ndescription: Triage tricky\nitems:\n  - ref: store/inbox/tricky.memo.card\n---\n",
);
const content = await box.read("box/jobs/y.intake.job.card");

const desc = await buildJobDescription(
  { card: { file: "y.intake.job.card", priority: "normal" }, relPath: "box/jobs/y.intake.job.card", content },
  box.root,
);

// The inlined ref (its whole file, frontmatter included) sits inside a
// four-backtick fence, so the body's own ``` run can't close it early.
desc.includes("#### store/inbox/tricky.memo.card\n````\n")
=> true

desc.includes("text\n```\nfenced inner\n```\nmore\n````")
=> true

await box.cleanup();
```
