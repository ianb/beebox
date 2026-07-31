# Photo batch threshold

`shouldBatchPhotos` decides whether a photo selection rides inline in the chat
message or gets uploaded as a batch instead. A few photos belong in the message;
a camera roll does not — inlining one base64-encodes tens of megabytes into a
single `/chat/send` that cannot be sent
(`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`).

The rule is duplicated in the iOS composer, which cannot import it; the shared
statement of record is `docs/mobile-contract.md`.

```ts setup
import { INLINE_PHOTO_LIMIT, shouldBatchPhotos } from "../../src/frontend/src/components/chat/photo-batch-threshold.js";
```

## Up to the limit stays inline; one more batches

```ts
JSON.stringify({
  limit: INLINE_PHOTO_LIMIT,
  one: shouldBatchPhotos({ existingInline: 0, incoming: 1 }),
  atLimit: shouldBatchPhotos({ existingInline: 0, incoming: 4 }),
  overLimit: shouldBatchPhotos({ existingInline: 0, incoming: 5 }),
  cameraRoll: shouldBatchPhotos({ existingInline: 0, incoming: 70 }),
})
=> {"limit":4,"one":false,"atLimit":false,"overLimit":true,"cameraRoll":true}
```

## Photos already in the composer count toward the limit

The decision is made against the composer's *total* inline count, not just the
new selection — so the inline payload stays bounded however many separate
selections a user makes. Three already inline plus two more is five, so the new
two batch rather than pushing the message to five inline photos.

```ts
JSON.stringify({
  threePlusOne: shouldBatchPhotos({ existingInline: 3, incoming: 1 }),
  threePlusTwo: shouldBatchPhotos({ existingInline: 3, incoming: 2 }),
  fullPlusOne: shouldBatchPhotos({ existingInline: 4, incoming: 1 }),
})
=> {"threePlusOne":false,"threePlusTwo":true,"fullPlusOne":true}
```

## Photos still encoding count too

`existingInline` must include the store's `pendingImages`, not just finished
ones. Image processing is async, so two four-photo pastes in quick succession
would otherwise both observe zero finished images, both inline, and land eight
inline photos — breaking the bound via exactly the race it exists to prevent.

```ts
JSON.stringify({
  fourStillEncodingPlusOne: shouldBatchPhotos({ existingInline: 4, incoming: 1 }),
  twoDonePlusTwoEncodingPlusOne: shouldBatchPhotos({ existingInline: 2 + 2, incoming: 1 }),
  threeEncodingPlusOne: shouldBatchPhotos({ existingInline: 3, incoming: 1 }),
})
=> {"fourStillEncodingPlusOne":true,"twoDonePlusTwoEncodingPlusOne":true,"threeEncodingPlusOne":false}
```

## An empty selection never batches

Paste and drop both route through the same predicate, and both can fire with
nothing attached.

```ts
JSON.stringify({
  emptyFresh: shouldBatchPhotos({ existingInline: 0, incoming: 0 }),
  emptyWhenFull: shouldBatchPhotos({ existingInline: 4, incoming: 0 }),
})
=> {"emptyFresh":false,"emptyWhenFull":false}
```
