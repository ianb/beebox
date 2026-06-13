# card-io: Phase 2 markdown-frontmatter card format

End-to-end round-trip for the new `.card` file format. The host (this
module) owns YAML parsing; cardworks provides the schema primitives
and the frontmatter splitter.

```ts setup
import { z } from "zod";
import {
  cardSchema,
  body,
  element,
  type CardSchema,
  type ElementSchema,
} from "cardworks";
import {
  parseCardText,
  serializeCardText,
  loadCardFromText,
  type LoadCardContext,
} from "../src/core/card-io.js";
import { createCardSchemaMap } from "../src/schemas/registry.js";
import { createIntakeJobTemplate } from "../src/schemas/intake-job.js";

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
```

## A pure-frontmatter card (no body) parses cleanly

```
const text = "---\ntype: email-thread\nthread-id: abc123\nsubject: Re Weekend plans\nparticipants:\n  - alice@example.com\n  - bob@example.com\n---\n";
const card = parseCardText(text, { source: "thread.email-thread.card", schemas });
JSON.stringify(card.fields)
=> {"type":"email-thread","thread-id":"abc123","subject":"Re Weekend plans","participants":["alice@example.com","bob@example.com"]}

card.contentType === undefined
=> true
```

## A card with a markdown body parses both halves

```
const text = "---\ntype: doc\ndrive-id: drv-1\ntitle: Project Notes\n---\n# Project Notes\n\nBody content goes here.\n";
const card = parseCardText(text, { source: "x.doc.card", schemas });
card.fields["title"]
=> Project Notes

JSON.stringify(card.fields["body"])
=> "# Project Notes\n\nBody content goes here.\n"
```

## Missing `type` field surfaces a clear error

```
const tryParse = (text: string, source: string): string => {
  try { parseCardText(text, { source, schemas }); return "did not throw"; }
  catch (e) { return (e as Error).message; }
};
tryParse("---\nsubject: nope\n---\n", "broken.card")
=> broken.card: cannot determine card type — filename must match Foo.<type>.card
```

## Round-trip: serialize then parse returns the same fields

```
const fields = {
  type: "doc",
  "drive-id": "drv-42",
  title: "Round-trip",
  body: "Hello, world.\n",
};
const text = serializeCardText({ schema: docSchema, fields });
const parsed = parseCardText(text, { source: "rt.doc.card", schemas });
JSON.stringify(parsed.fields)
=> {"type":"doc","drive-id":"drv-42","title":"Round-trip","body":"Hello, world.\n"}
```

## Frontmatter-only schemas reject body content

```ts setup
function tryParse2(text: string, source: string): string {
  try { parseCardText(text, { source, schemas }); return "did not throw"; }
  catch (e) { return (e as Error).message; }
}
```

```
tryParse2("---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\n---\nunexpected body\n", "extra.email-thread.card")
=> extra.email-thread.card: schema "email-thread" declares no body, but file has body content
```

## Loader dispatch routes new and legacy cards to the right path

```ts setup
const xmlMemo: ElementSchema = element("memo", {
  attrs: { status: z.string() },
});

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([
    ["doc", docSchema],
    ["email-thread", threadSchema],
  ]),
  elementSchemas: new Map<string, ElementSchema>([
    ["memo", xmlMemo],
  ]),
};
```

A file whose `type:` matches a CardSchema dispatches to the frontmatter path.

```
const text = "---\ntype: email-thread\nthread-id: t9\nsubject: hi\nparticipants:\n  - a@x\n---\n";
const loaded = await loadCardFromText({ content: text, source: "thread.email-thread.card", ctx });
loaded.kind
=> frontmatter

loaded.kind === "frontmatter" ? loaded.schema.type : "?"
=> email-thread

loaded.kind === "frontmatter" ? loaded.fields["thread-id"] : "?"
=> t9
```

Job cards use the dotted filename convention `Foo.<kind>.job.card` (the
reactor discovers jobs by that suffix) while their schemas register under
hyphenated names — `*.intake.job.card` dispatches to `intake-job`. This
regressed once when the filename discriminator only read the last dot
segment ("job"), making every generated job card fail validation:

```
const registryCtx: LoadCardContext = {
  cardSchemas: createCardSchemaMap(),
  elementSchemas: new Map(),
};
const content = createIntakeJobTemplate({
  created: "2026-06-09T00:00:00Z",
  source: "gmail",
  description: "Triage 1 inbox item",
  items: ["box/inbox/a.memo.card"],
});
const loaded = await loadCardFromText({ content, source: "2026-06-09-gmail.intake.job.card", ctx: registryCtx });
loaded.kind
=> frontmatter

loaded.kind === "frontmatter" ? loaded.schema.type : "?"
=> intake-job
```

A file whose frontmatter `type:` is unknown falls through to the XML path so legacy XML cards (with a content-type frontmatter only) keep working.

```
const text = "---\ncontent-type: application/x-card+xml\n---\n<memo status=\"new\"/>";
const loaded = await loadCardFromText({ content: text, source: "legacy.memo.card", ctx });
loaded.kind
=> xml

loaded.kind === "xml" ? loaded.element.tagName : "?"
=> memo

loaded.kind === "xml" ? loaded.schema?.tagName : "?"
=> memo
```
