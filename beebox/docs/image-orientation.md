# Image orientation contract

Photos carry an EXIF **orientation** tag (values 1–8: rotations and mirrors) so a
camera can store sensor-native pixels and let the viewer rotate them. That only
works if *every* downstream decoder honors the tag. Images enter a box through
several routes — some re-render pixels, others forward the source bytes — so a
tag that one boundary drops makes a photo that looked upright at capture render
rotated later (the bug this contract closes).

## The invariant

**An image at rest inside a box is orientation-normalized:** its pixels are
already upright and it carries no non-trivial EXIF orientation (value `1`, or
none). Every path that *transcodes* an image must bake the orientation into the
pixels and emit a value-`1` / absent tag.

The oracle is [`src/shared/image-orientation.ts`](../src/shared/image-orientation.ts)
— `readJpegOrientation(bytes)` returns the EXIF orientation (1–8), and
`isOrientationNormalized(bytes)` is the contract predicate. It is pure and shared
by the backend and frontend. Tested across all eight values (both TIFF byte
orders) and hostile inputs in
[`test/shared/image-orientation.doctest.md`](../test/shared/image-orientation.doctest.md).

## Ingress inventory

| Path | How orientation is handled | Status |
|------|----------------------------|--------|
| Browser paste / drop / file | `image-paste.ts` `decodeOriented` decodes with `createImageBitmap(..., { imageOrientation: "from-image" })` (falling back to `<img>`, whose default is also from-image), then the canvas re-encode emits upright pixels with no tag | Normalized |
| Browser camera | `camera.ts` draws a live `getUserMedia` video frame to a canvas — upright by construction, no EXIF | Normalized |
| Screenshot capture / relay | Canvas / PNG capture — no EXIF | Normalized |
| Native camera & photo library (iOS) | `NativeComposerView.swift` redraws the `UIImage` upright via `UIGraphicsImageRenderer` before JPEG/PNG compression | Normalized (Swift) |
| Chat send (server ingress) | No codec server-side; `warnOnUnnormalizedImageOrientation` (`chat-helpers.ts`) reads the EXIF tag and **logs** a contract violation so a non-conforming client is visible | Guarded (detect, not fix) |
| Stored image files → `<img>` render | The `Image` primitive renders through `<img>`, whose default `image-orientation: from-image` displays them correctly | Honored at render |

## What is deliberately left (see the closed issue)

The server has **no image codec** (no `sharp`/`jimp`), so it cannot re-render
pixels — it can only detect and warn. Two gaps remain, both out of scope for a
pure-TS change:

- **Pre-existing stored files handed to the model.** A JPEG already in a box that
  carries an orientation tag, sent to the model as raw bytes, depends on the model
  honoring EXIF. Normalizing those needs a server-side codec (a future intake
  step, tracked with the PNG→WebP archival idea).
- **Real-browser / real-device coverage.** The reader is unit-tested for all
  eight values, but end-to-end coverage of each orientation through a live
  browser canvas and a physical iPhone can only be confirmed by hand.

History: `issues/closed/bugs/2026-07-17-image-orientation-exif-boundaries.md`.
