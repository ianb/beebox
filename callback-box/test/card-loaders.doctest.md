# Card Loaders

Per-card-type loaders produce typed `FileSummary` values from parsed card elements.

```ts setup
import { memoLoader } from "../src/schemas/memo.js";
import { imageLoader } from "../src/schemas/image.js";
import { emptyLocation, type ElementNode } from "cardworks";

function el(tagName: string, attrs: Record<string, string>, children: ElementNode[] = []): ElementNode {
  return {
    tagName,
    attrs,
    children,
    comments: {},
    location: emptyLocation(),
    dirty: false,
  } as ElementNode;
}

function textChild(tagName: string, text: string): ElementNode {
  return { ...el(tagName, {}), text } as ElementNode;
}
```

## Memo — title from `<content>`

```
const memo = el("memo", { status: "new" }, [
  textChild("content", "Pick up milk on the way home."),
]);
const s = memoLoader({ path: "box/inbox/Groceries.memo.card", element: memo });
s.title
=> Pick up milk on the way home.

s.tagName
=> memo

JSON.stringify(s.attrs)
=> {"status":"new"}
```

## Memo — falls back to `<transcription>` when content is empty

```
const memo = el("memo", { status: "processing" }, [
  textChild("content", ""),
  textChild("transcription", "This is the transcribed audio."),
]);
memoLoader({ path: "Voice.memo.card", element: memo }).title
=> This is the transcribed audio.
```

## Memo — filename fallback when neither is present

```
const memo = el("memo", { status: "new" });
memoLoader({ path: "box/inbox/Blank_Thought.memo.card", element: memo }).title
=> Blank Thought
```

## Memo — truncates long titles

```
const memo = el("memo", { status: "new" }, [
  textChild("content", "a".repeat(200)),
]);
const s = memoLoader({ path: "x.memo.card", element: memo });
s.title.length
=> 80

s.title.endsWith("…")
=> true
```

## Memo — invalid status collapses to "new"

```
const memo = el("memo", { status: "bogus" }, [textChild("content", "x")]);
JSON.stringify(memoLoader({ path: "x.memo.card", element: memo }).attrs)
=> {"status":"new"}
```

## Image — title from `<description>`

```
const image = el("image", { status: "analyzed", "has-text": "true" }, [
  textChild("description", "Whiteboard with project timeline"),
]);
imageLoader({ path: "photo.image.card", element: image }).title
=> Whiteboard with project timeline
```

## Image — falls back to filename element

```
const image = el("image", { status: "new" }, [
  el("filename", { name: "photo-001.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" }),
]);
imageLoader({ path: "box/capture/session.image.card", element: image }).title
=> photo 001
```

## Image — passes through optional attrs

```
const image = el("image", { status: "analyzed", "has-text": "true", rotation: "90" }, [
  textChild("description", "Note"),
]);
const s = imageLoader({ path: "p.image.card", element: image });
JSON.stringify(s.attrs)
=> {"status":"analyzed","has-text":"true","rotation":"90"}
```
