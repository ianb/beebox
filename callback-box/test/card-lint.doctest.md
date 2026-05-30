# card-lint: dispatching XML and frontmatter cards

`lintCardsDispatch` is the validate-time counterpart to
`loadCardFile`: it picks the right validator for each file based on
its frontmatter, then merges results into a single LintSummary.

```ts setup
import { z } from "zod";
import {
  body,
  cardSchema,
  element,
  type CardSchema,
  type ElementSchema,
} from "cardworks";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { createLoader } from "../src/cli/lib/loader.js";
import { lintCardsDispatch } from "../src/core/card-lint.js";
import type { LoadCardContext } from "../src/core/card-io.js";

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

const memoSchema: ElementSchema = element("memo", {
  attrs: { status: z.string() },
});

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([
    ["email-thread", threadSchema],
    ["doc", docSchema],
  ]),
  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
};
```

## Frontmatter cards that satisfy their schema lint clean

```
const box = await makeTmpBox();
await box.write(
  "box/inbox/email/thread-x.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread-x.attach/msg-001.email-message.card\n---\n",
);
await box.write(
  "box/inbox/email/thread-x.attach/msg-001.email-message.card",
  "---\ncontent-type: application/x-card+xml\n---\n<email-message message-id=\"m1\" thread-id=\"t1\"><from>a@x</from><date>2026-02-15T10:00:00Z</date><subject>hi</subject><body-file>attach/msg-001.body.txt</body-file></email-message>\n",
);
const loader = await createLoader(box.root);
const result = await lintCardsDispatch(
  [box.path("box/inbox/email/thread-x.email-thread.card")],
  { loader, ctx },
);
result.totalErrors
=> 0

result.filesChecked
=> 1
```

## Schema violations in frontmatter cards surface as lint errors

```
const box = await makeTmpBox();
await box.write(
  "box/inbox/email/broken.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\n---\n",
);
const loader = await createLoader(box.root);
const result = await lintCardsDispatch(
  [box.path("box/inbox/email/broken.email-thread.card")],
  { loader, ctx },
);
result.totalErrors
=> 1

result.results[0]!.errors[0]!.message.includes("invalid email-thread frontmatter")
=> true
```

## Broken refs in frontmatter cards are reported as warnings

Each entry in a ref-declared field is resolved against the loader; missing
targets surface as lint warnings (not errors) carrying the field path. Broken
refs are warnings because they commonly arise from legitimate operations
(referents being moved, archived, trashed, or hand-deleted), and treating
each as a hard error would block commits on any box with accumulated drift.

```
const box = await makeTmpBox();
await box.write(
  "box/inbox/email/thread-x/thread.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
);
const loader = await createLoader(box.root);
const result = await lintCardsDispatch(
  [box.path("box/inbox/email/thread-x/thread.email-thread.card")],
  { loader, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> Broken reference at messages[0].ref: thread.attach/missing.email-message.card does not exist
```

## Broken refs in Markdoc body tags surface as warnings too

Refs carried by Markdoc tag attributes inside a card body (e.g.
`{% source ref="..." %}`, `{% subrecipe ref="..." %}`) get the same
broken-ref treatment as frontmatter refs — resolved against the loader,
missing targets reported as warnings. The path field on the warning
points at `body:<line>:<tagName>.<attr>` so the human can locate it.
Ref paths follow the same convention as frontmatter refs: leading `/`
is box-root-absolute (the convention recommended by `record.tsx`'s
instructions); bare paths are resolved relative to the source card.

```
const box = await makeTmpBox();
await box.write(
  "box/notes/Meeting.doc.card",
  "---\ntype: doc\ntitle: Meeting Notes\n---\nDana made the call: {% source ref=\"/box/people/missing.person.card\" as=\"verbatim\" %}{% /source %}\n",
);
const loader = await createLoader(box.root);
const result = await lintCardsDispatch(
  [box.path("box/notes/Meeting.doc.card")],
  { loader, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> Broken reference at body:1:source.ref: /box/people/missing.person.card does not exist
```

## Resolved body refs lint clean

A body Markdoc tag whose `ref` resolves to an existing target produces
no warning, same as a resolved frontmatter ref.

```
const box = await makeTmpBox();
await box.write(
  "box/people/dana.person.card",
  "---\ntype: person\nname: Dana\n---\n",
);
await box.write(
  "box/notes/Meeting.doc.card",
  "---\ntype: doc\ntitle: Meeting Notes\n---\nDana said: {% source ref=\"/box/people/dana.person.card\" as=\"verbatim\" %}ship Friday{% /source %}\n",
);
const loader = await createLoader(box.root);
const result = await lintCardsDispatch(
  [box.path("box/notes/Meeting.doc.card")],
  { loader, ctx },
);
result.totalWarnings
=> 0
```

## XML cards still flow through the existing cardworks lintCard path

```
const box = await makeTmpBox();
await box.write(
  "box/inbox/Note.memo.card",
  "---\ncontent-type: application/x-card+xml\n---\n<memo status=\"new\"/>\n",
);
const loader = await createLoader(box.root);
const result = await lintCardsDispatch(
  [box.path("box/inbox/Note.memo.card")],
  { loader, ctx },
);
result.totalErrors
=> 0
```
