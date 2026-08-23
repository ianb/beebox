# File routing (chat composer)

`routeAddedFiles` decides where a set of files handed to the chat composer goes:
inline in the message being composed, or up as a bulk-upload batch. It is the
whole answer to the composer's one "Add files…" menu entry — the user never
picks a path (`issues/features/2026-08-03-attach-vs-upload-menu-confusing.md`).

A few photos belong in the message; a camera roll does not — inlining one
base64-encodes tens of megabytes into a single `/chat/send` that cannot be sent
(`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`). Non-images have no
inline representation at all, so they always batch.

The photo-limit half of the rule is duplicated in the iOS composer, which cannot
import it; the shared statement of record is `docs/mobile-contract.md`.

```ts setup
import { INLINE_PHOTO_LIMIT, routeAddedFiles } from "../../src/frontend/src/components/chat/file-routing.js";

/** Stand-ins for `File`s — routing reads nothing but the MIME type. */
const photos = (n: number) => Array.from({ length: n }, () => ({ type: "image/jpeg" }));
const pdf = { type: "application/pdf" };
```

## Up to the limit stays inline; one more batches

```ts
JSON.stringify({
  limit: INLINE_PHOTO_LIMIT,
  one: routeAddedFiles({ files: photos(1), existingInline: 0 }),
  atLimit: routeAddedFiles({ files: photos(3), existingInline: 0 }),
  overLimit: routeAddedFiles({ files: photos(4), existingInline: 0 }),
  cameraRoll: routeAddedFiles({ files: photos(70), existingInline: 0 }),
})
=> {"limit":3,"one":"inline","atLimit":"inline","overLimit":"batch","cameraRoll":"batch"}
```

## Anything that isn't an image batches, however few

A document can't ride inline as an image, and one is something to file rather
than something for the model to look at mid-sentence. A mixed set goes whole to
the batch — splitting it would put half the selection somewhere the composer
text no longer describes.

```ts
JSON.stringify({
  onePdf: routeAddedFiles({ files: [pdf], existingInline: 0 }),
  mixed: routeAddedFiles({ files: [...photos(1), pdf], existingInline: 0 }),
  pdfWhenEmpty: routeAddedFiles({ files: [pdf], existingInline: 0 }),
})
=> {"onePdf":"batch","mixed":"batch","pdfWhenEmpty":"batch"}
```

## Photos already in the composer count toward the limit

The decision is made against the composer's *total* inline count, not just the
new selection — so the inline payload stays bounded however many separate
selections a user makes. Two already inline plus two more is four, so the new
two batch rather than pushing the message to four inline photos.

```ts
JSON.stringify({
  twoPlusOne: routeAddedFiles({ files: photos(1), existingInline: 2 }),
  twoPlusTwo: routeAddedFiles({ files: photos(2), existingInline: 2 }),
  fullPlusOne: routeAddedFiles({ files: photos(1), existingInline: 3 }),
})
=> {"twoPlusOne":"inline","twoPlusTwo":"batch","fullPlusOne":"batch"}
```

## Photos still encoding count too

`existingInline` must include the store's `pendingImages`, not just finished
ones. Image processing is async, so two three-photo pastes in quick succession
would otherwise both observe zero finished images, both inline, and land six
inline photos — breaking the bound via exactly the race it exists to prevent.

```ts
JSON.stringify({
  threeStillEncodingPlusOne: routeAddedFiles({ files: photos(1), existingInline: 3 }),
  oneDonePlusTwoEncodingPlusOne: routeAddedFiles({ files: photos(1), existingInline: 1 + 2 }),
  twoEncodingPlusOne: routeAddedFiles({ files: photos(1), existingInline: 2 }),
})
=> {"threeStillEncodingPlusOne":"batch","oneDonePlusTwoEncodingPlusOne":"batch","twoEncodingPlusOne":"inline"}
```

## An empty selection never batches

Paste and drop both route through the same function, and both can fire with
nothing attached. Saying "inline" for an empty set keeps a stray event from
opening an empty batch overlay.

```ts
JSON.stringify({
  emptyFresh: routeAddedFiles({ files: [], existingInline: 0 }),
  emptyWhenFull: routeAddedFiles({ files: [], existingInline: 3 }),
})
=> {"emptyFresh":"inline","emptyWhenFull":"inline"}
```
