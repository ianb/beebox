# Chat user-message display stripping

`stripUserDisplayTags` removes the system-injected halves of a sent message
before display. Inline `[file#N]` tokens are the machine half of the
attachments contract (`chat-assemble.ts`): they anchor where an attached file
sits in the text and resolve through the `<attachments>` block. The block is
stripped and the file renders as its own chip, so the bare token used to
survive into the visible bubble looking like a typo the user never wrote
(field-test finding). Only tokens the block declares are stripped —
user-typed lookalikes stay.

```ts setup
import { stripUserDisplayTags } from "../../../src/frontend/src/components/chat/message-parsing.js";
```

A composed attach message: the block and its declared token both vanish; the
prose stays intact.

```ts
const sent = [
  "Here's the recipe [file#1] from my files.",
  "<attachments>",
  "[file#1]: _tmp/1723200000_lemon-chicken.txt",
  "</attachments>",
].join("\n");
JSON.stringify(stripUserDisplayTags(sent).trim())
=> "Here's the recipe from my files."
```

The same message in the pre-rename form — every transcript written before
2026-08-25 looks like this, and the bubble must read the same either way.

```ts
const legacy = [
  "Here's the recipe [file1] from my files.",
  "<attachments>",
  "[file1]: _tmp/1723200000_lemon-chicken.txt",
  "</attachments>",
].join("\n");
JSON.stringify(stripUserDisplayTags(legacy).trim())
=> "Here's the recipe from my files."
```

A `[file1]` the user actually typed — no attachments block declaring it —
is their own text and survives:

```ts
stripUserDisplayTags("I renamed [file1] to notes.txt yesterday.")
=> I renamed [file1] to notes.txt yesterday.
```

Declared and undeclared tokens in one message: only the declared one goes.

```ts
const mixed = [
  "Compare [file2] with [file9].",
  "<attachments>",
  "[file2]: _tmp/1723200000_report.pdf",
  "</attachments>",
].join("\n");
JSON.stringify(stripUserDisplayTags(mixed).trim())
=> "Compare with [file9]."
```

## Review-round cases: split blocks, punctuation, spacing

`[imageN]` expansion splits a sent message into several text blocks, so the
`<attachments>` block can live in a LATER block than a file token. Callers
with the whole entry pass the declared ids in; the fragment then strips its
token without seeing the declaration:

```ts
stripUserDisplayTags("see [file1] and more", { attachedFileIds: new Set([1]) })
=> see and more

stripUserDisplayTags("see [file1] and more", { attachedFileIds: new Set() })
=> see [file1] and more
```

A declared token takes its surrounding spaces with it — no stranded space
before punctuation, no doubled interior space:

```ts
const declared = { attachedFileIds: new Set([1]) };
JSON.stringify(stripUserDisplayTags("Here's the recipe [file1].", declared))
=> "Here's the recipe."

JSON.stringify(stripUserDisplayTags("[file1] is attached", declared))
=> "is attached"
```
