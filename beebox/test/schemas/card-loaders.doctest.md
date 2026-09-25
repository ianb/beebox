# Card Summaries

Each card type owns how it appears in a list, through its schema's `summarize`
hook. The registry builds the base summary and the type extends or replaces it.

```ts setup
import { MemoSchema } from "../../src/schemas/memo.js";
import { ImageSchema } from "../../src/schemas/image.js";
import { summarize } from "../../src/core/loader-registry.js";
import type { CardSchema } from "../../src/cards/schema.js";

const schemas = new Map<string, CardSchema>([
  ["memo", MemoSchema],
  ["image", ImageSchema],
]);

function summaryOf(path: string, fields: Record<string, unknown>) {
  const type = fields["type"];
  return summarize({ path, type: typeof type === "string" ? type : undefined, fields }, schemas);
}
```

## Memo — title from body

```ts
const m1 = {
  type: "memo",
  status: "new",
  created: "2024-01-15T10:00:00Z",
  body: "Pick up milk on the way home.",
};
const s = summaryOf("_content/inbox/Groceries.memo.card", m1);
s.title
=> Pick up milk on the way home.

s.type
=> memo

JSON.stringify(s.attrs)
=> {"status":"new"}
```

## Memo — falls back to `transcription.text` when body is empty

```ts
const m2 = {
  type: "memo",
  status: "processing",
  created: "2024-01-15T10:00:00Z",
  body: "",
  transcription: { text: "This is the transcribed audio." },
};
summaryOf("Voice.memo.card", m2).title
=> This is the transcribed audio.
```

## Memo — filename fallback when neither is present

```ts
const m3 = {
  type: "memo",
  status: "new",
  created: "2024-01-15T10:00:00Z",
  body: "",
};
summaryOf("_content/inbox/Blank_Thought.memo.card", m3).title
=> Blank Thought
```

A memo with neither body nor transcription but an authored `title:` shows the
title: the fallback is the base summary, not the bare filename.

```ts continue
summaryOf("_content/inbox/Blank_Thought.memo.card", { ...m3, title: "Something I meant to write" }).title
=> Something I meant to write
```

## Memo — truncates long titles

```ts
const m4 = {
  type: "memo",
  status: "new",
  created: "2024-01-15T10:00:00Z",
  body: "a".repeat(200),
};
const s = summaryOf("x.memo.card", m4);
s.title.length
=> 80

s.title.endsWith("…")
=> true
```

## Image — title from description field

```ts
const fields1 = {
  type: "image",
  status: "analyzed",
  "has-text": true,
  filename: { ref: "attach/photo.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
  description: "Whiteboard with project timeline",
};
summaryOf("photo.image.card", fields1).title
=> Whiteboard with project timeline
```

## Image — falls back to filename ref

```ts
const fields2 = {
  type: "image",
  status: "new",
  filename: { ref: "photo-001.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
};
summaryOf("_content/inbox/session.image.card", fields2).title
=> photo 001
```

## Image — passes through optional attrs

```ts
const fields3 = {
  type: "image",
  status: "analyzed",
  "has-text": true,
  rotation: "90",
  filename: { ref: "attach/p.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
  description: "Note",
};
const s = summaryOf("p.image.card", fields3);
JSON.stringify(s.attrs)
=> {"status":"analyzed","has-text":true,"rotation":"90","filename":"attach/p.jpg"}
```

## An unparsed card of either type keeps the filename

Neither type's hook runs without validated fields.

```ts
const memo = summarize({ path: "_content/inbox/Unread_Note.memo.card" }, schemas);
const image = summarize({ path: "_content/inbox/photo-002.image.card" }, schemas);
[memo.title, memo.attrs, image.title, image.attrs].join("|")
=> Unread Note||photo 002|
```
