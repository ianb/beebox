# File routing (chat composer)

`routeAddedFiles` decides how a set of files handed to the chat composer is
*represented* in the message being written — not where it goes. Both halves of
its answer land in that message; the user never picks a path
(`issues/features/2026-08-03-attach-vs-upload-menu-confusing.md`).

- **inline** — a photo, base64-encoded into the `/chat/send` body and anchored
  by `[image#N]`. Bounded by `INLINE_PHOTO_LIMIT`, because this is the one thing
  that puts bytes in the send: a camera roll inlined is tens of megabytes in a
  single request that cannot be sent
  (`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`).
- **upload** — everything else: any non-image, and photos over that limit.
  Uploaded ahead of the send and anchored by `[file#N]`, carrying only a path,
  so it adds nothing to the payload however large it is. No count or size limit.

An earlier version routed every non-image to the full-screen bulk-upload
overlay, which sends a message of its own — so a PDF could not be attached to
the sentence you were writing
(`issues/bugs/2026-09-06-add-files-cannot-attach-a-couple-of-files-inline.md`).

```ts setup
import { INLINE_PHOTO_LIMIT, routeAddedFiles } from "../../src/frontend/src/components/chat/file-routing.js";

/** Stand-ins for `File`s — routing reads nothing but the MIME type. */
const photo = (name: string) => ({ type: "image/jpeg", name });
const pdf = (name: string) => ({ type: "application/pdf", name });
const photos = (n: number) => Array.from({ length: n }, (_v, i) => photo(`p${String(i)}`));

/** Report the split by name, so which file went where is visible. */
const split = (files: { type: string; name: string }[], existingInlinePhotos: number) => {
  const r = routeAddedFiles({ files, existingInlinePhotos });
  return { inline: r.inline.map((f) => f.name), upload: r.upload.map((f) => f.name) };
};
```

## A few photos ride inline; a document rides alongside them

The everyday case, and the one the regression broke: a PDF and a photo picked
together both attach to the message, each in the representation that suits it.

```ts
JSON.stringify({
  limit: INLINE_PHOTO_LIMIT,
  onePhoto: split([photo("a.jpg")], 0),
  onePdf: split([pdf("report.pdf")], 0),
  mixed: split([photo("a.jpg"), pdf("report.pdf")], 0),
})
=> {"limit":3,"onePhoto":{"inline":["a.jpg"],"upload":[]},"onePdf":{"inline":[],"upload":["report.pdf"]},"mixed":{"inline":["a.jpg"],"upload":["report.pdf"]}}
```

## Non-images have no count or size limit

Their bound was the payload, and they aren't in it — a `[file#N]` carries a
path. So "a couple of files" and "a folder of scans" differ only in how many
chips appear.

```ts
JSON.stringify({
  threePdfs: split([pdf("a"), pdf("b"), pdf("c")], 0).upload,
  manyPdfs: routeAddedFiles({ files: Array.from({ length: 40 }, () => pdf("x")), existingInlinePhotos: 0 }).upload.length,
})
=> {"threePdfs":["a","b","c"],"manyPdfs":40}
```

## Photos past the inline limit take the upload representation

They aren't refused and they don't open anything — they just travel as
references instead of payload, which is the whole reason the limit is safe to
hold at a small number.

```ts
JSON.stringify({
  atLimit: split(photos(3), 0).inline.length,
  overLimit: split(photos(4), 0),
  cameraRoll: routeAddedFiles({ files: photos(70), existingInlinePhotos: 0 }),
})
=> {"atLimit":3,"overLimit":{"inline":[],"upload":["p0","p1","p2","p3"]},"cameraRoll":{"inline":[],"upload":«*»}}
```

## When the photos don't fit, the whole selection goes up together

Inlining part of a selection and uploading the rest would scatter one act across
two representations for no reason the user could predict — so the PDF's
companion photos join it rather than splitting off.

```ts
JSON.stringify({
  mixedOverLimit: split([...photos(4), pdf("report.pdf")], 0),
})
=> {"mixedOverLimit":{"inline":[],"upload":["p0","p1","p2","p3","report.pdf"]}}
```

## What's already in the composer counts, so picking twice builds one message

The decision reads the composer's *current* inline photo count, not just the new
selection. Two photos already there plus two more is four, so the new pair
uploads rather than pushing the message past the bound. (On iOS a pick is
per-source — photos or files, never both at once — so picking twice before
sending has to keep working.)

```ts
JSON.stringify({
  twoPlusOne: split(photos(1), 2).inline.length,
  twoPlusTwo: split(photos(2), 2),
  fullPlusOne: split(photos(1), 3),
  fullPlusPdf: split([pdf("report.pdf")], 3),
})
=> {"twoPlusOne":1,"twoPlusTwo":{"inline":[],"upload":["p0","p1"]},"fullPlusOne":{"inline":[],"upload":["p0"]},"fullPlusPdf":{"inline":[],"upload":["report.pdf"]}}
```

A file never costs a photo slot, and vice versa: `fullPlusPdf` above uploads the
PDF because that is what a PDF always does, not because the photos are full.

## Photos still encoding count too

`existingInlinePhotos` must include the store's `pendingImages`, not just
finished ones. Image processing is async, so two three-photo pastes in quick
succession would otherwise both observe zero finished images, both inline, and
land six inline photos — breaking the bound via exactly the race it exists to
prevent.

```ts
JSON.stringify({
  threeStillEncodingPlusOne: split(photos(1), 3).inline.length,
  oneDonePlusTwoEncodingPlusOne: split(photos(1), 1 + 2).inline.length,
  twoEncodingPlusOne: split(photos(1), 2).inline.length,
})
=> {"threeStillEncodingPlusOne":0,"oneDonePlusTwoEncodingPlusOne":0,"twoEncodingPlusOne":1}
```

## An empty selection splits into nothing

Paste and drop both route through here, and both can fire with nothing
attached.

```ts
JSON.stringify({
  emptyFresh: split([], 0),
  emptyWhenFull: split([], 3),
})
=> {"emptyFresh":{"inline":[],"upload":[]},"emptyWhenFull":{"inline":[],"upload":[]}}
```
