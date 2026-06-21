# Card Loaders

Per-card-type loaders produce typed `FileSummary` values from parsed card elements.

```ts setup
import { memoLoader } from "../../src/schemas/memo.js";
import { imageLoader } from "../../src/schemas/image.js";
```

## Memo — title from body

```ts
const m1 = {
  type: "memo",
  status: "new",
  created: "2024-01-15T10:00:00Z",
  body: "Pick up milk on the way home.",
};
const s = memoLoader({ path: "box/inbox/Groceries.memo.card", fields: m1 });
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
memoLoader({ path: "Voice.memo.card", fields: m2 }).title
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
memoLoader({ path: "box/inbox/Blank_Thought.memo.card", fields: m3 }).title
=> Blank Thought
```

## Memo — truncates long titles

```ts
const m4 = {
  type: "memo",
  status: "new",
  created: "2024-01-15T10:00:00Z",
  body: "a".repeat(200),
};
const s = memoLoader({ path: "x.memo.card", fields: m4 });
s.title.length
=> 80

s.title.endsWith("…")
=> true
```

## Memo — defaults to "new" when fields are missing

```ts
const s = memoLoader({ path: "x.memo.card" });
JSON.stringify(s.attrs)
=> {"status":"new"}
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
imageLoader({ path: "photo.image.card", fields: fields1 }).title
=> Whiteboard with project timeline
```

## Image — falls back to filename ref

```ts
const fields2 = {
  type: "image",
  status: "new",
  filename: { ref: "photo-001.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
};
imageLoader({ path: "box/capture/session.image.card", fields: fields2 }).title
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
const s = imageLoader({ path: "p.image.card", fields: fields3 });
JSON.stringify(s.attrs)
=> {"status":"analyzed","has-text":true,"rotation":"90","filename":"attach/p.jpg"}
```
