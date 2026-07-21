# Chat ingress flags images that skipped orientation normalization

`warnOnUnnormalizedImageOrientation` is the server-side half of the orientation
contract: chat images are supposed to arrive already normalized (the browser
transcode bakes orientation into pixels, native clients redraw upright). The
server has no image codec to correct a rotated one, so when a JPEG shows up
carrying a non-trivial EXIF orientation it logs a loud, visible warning rather
than silently forwarding a photo the model will see sideways.

```ts setup
import { warnOnUnnormalizedImageOrientation } from "../../../src/webapp/routes/chat-helpers.js";

// Minimal JPEG carrying a single EXIF Orientation tag (little-endian TIFF).
function exifJpegBase64(orientation) {
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  const tiff = [0x49, 0x49, ...u16(0x2a), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0x00, 0x00, ...u32(0)];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const app1Len = exif.length + 2;
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, ...exif, 0xff, 0xd9]);
  return Buffer.from(bytes).toString("base64");
}

// Capture console.warn for the duration of a call.
function warnings(fn) {
  const original = console.warn;
  const captured = [];
  console.warn = (...args) => captured.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return captured;
}
```

## A rotated JPEG warns; a normalized one is silent

```ts
const rotated = warnings(() =>
  warnOnUnnormalizedImageOrientation([{ id: 3, mimeType: "image/jpeg", dataBase64: exifJpegBase64(6) }]),
);
`${rotated.length} :: ${rotated[0]}`
=> 1 :: [chat] inbound image #3 carries EXIF orientation 6 (expected 1); a client transcode path skipped orientation normalization — the model may see it rotated
```

An orientation-1 (upright) JPEG is already normalized, so nothing is logged.

```ts continue
warnings(() => warnOnUnnormalizedImageOrientation([{ id: 1, mimeType: "image/jpeg", dataBase64: exifJpegBase64(1) }])).length
=> 0
```

## Non-JPEG attachments are never flagged

Canvas WebP/PNG output carries no EXIF orientation, so those types are skipped
without even decoding — only JPEG can carry the tag.

```ts continue
warnings(() => warnOnUnnormalizedImageOrientation([{ id: 2, mimeType: "image/webp", dataBase64: exifJpegBase64(6) }])).length
=> 0
```
