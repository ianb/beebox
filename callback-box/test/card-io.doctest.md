# card-io: Phase 2 markdown-frontmatter card format

End-to-end round-trip for the new `.card` file format. The host (this
module) owns YAML parsing; cardworks provides the schema primitives
and the frontmatter splitter.

```ts setup
import { z } from "zod";
import { cardSchema, body, type CardSchema } from "cardworks";
import { parseCardText, serializeCardText } from "../src/core/card-io.js";

const docSchema: CardSchema = cardSchema("doc", {
  fields: {
    "drive-id": z.string(),
    title: z.string(),
    content: body(z.string()),
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
const card = parseCardText(text, { source: "thread.card", schemas });
JSON.stringify(card.fields)
=> {"type":"email-thread","thread-id":"abc123","subject":"Re Weekend plans","participants":["alice@example.com","bob@example.com"]}

card.contentType === undefined
=> true
```

## A card with a markdown body parses both halves

```
const text = "---\ntype: doc\ndrive-id: drv-1\ntitle: Project Notes\n---\n# Project Notes\n\nBody content goes here.\n";
const card = parseCardText(text, { source: "doc.card", schemas });
card.fields["title"]
=> Project Notes

JSON.stringify(card.fields["content"])
=> "# Project Notes\n\nBody content goes here.\n"
```

## Missing `type` field surfaces a clear error

```
const tryParse = (text: string, source: string): string => {
  try { parseCardText(text, { source, schemas }); return "did not throw"; }
  catch (e) { return (e as Error).message; }
};
tryParse("---\nsubject: nope\n---\n", "broken.card")
=> broken.card: frontmatter is missing required `type` field
```

## Round-trip: serialize then parse returns the same fields

```
const fields = {
  type: "doc",
  "drive-id": "drv-42",
  title: "Round-trip",
  content: "Hello, world.\n",
};
const text = serializeCardText({ schema: docSchema, fields });
const parsed = parseCardText(text, { source: "rt.card", schemas });
JSON.stringify(parsed.fields)
=> {"type":"doc","drive-id":"drv-42","title":"Round-trip","content":"Hello, world.\n"}
```

## Frontmatter-only schemas reject body content

```ts setup
function tryParse2(text: string, source: string): string {
  try { parseCardText(text, { source, schemas }); return "did not throw"; }
  catch (e) { return (e as Error).message; }
}
```

```
tryParse2("---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\n---\nunexpected body\n", "extra.card")
=> extra.card: schema "email-thread" declares no body, but file has body content
```
