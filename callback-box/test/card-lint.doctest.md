# card-lint: dispatching XML and frontmatter cards

`lintCardsDispatch` is the validate-time counterpart to
`loadCardFile`: it picks the right validator for each file based on
its frontmatter, then merges results into a single LintSummary.

```ts setup
import { z } from "zod";
import {
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
    messages: z.array(z.string()),
  },
});

const memoSchema: ElementSchema = element("memo", {
  attrs: { status: z.string() },
});

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([["email-thread", threadSchema]]),
  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
};
```

## Frontmatter cards that satisfy their schema lint clean

```
const box = await makeTmpBox();
await box.write(
  "box/inbox/email/thread-x.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - attach/msg-001.email-message.card\n---\n",
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

result.results[0]!.errors[0]!.message.includes("frontmatter validation failed")
=> true
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
