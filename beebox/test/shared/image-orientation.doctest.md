# EXIF image-orientation reader — the ingress-normalization oracle

`shared/image-orientation.ts` defines the orientation contract: an image at rest
inside a box is *normalized* — pixels upright, no non-trivial EXIF orientation.
`readJpegOrientation` is the oracle that lets a boundary check that. It parses
the EXIF Orientation tag (values 1–8) out of a JPEG's leading APP1 segment, and
returns {@link ORIENTATION_NORMAL} (1) for anything with no orientation to honor.

```ts setup
import {
  readJpegOrientation,
  isOrientationNormalized,
  ORIENTATION_NORMAL,
} from "../../src/shared/image-orientation.js";

// Build a minimal JPEG whose only content is an EXIF APP1 segment carrying the
// given Orientation tag. `endian` selects the TIFF byte order ("II" little /
// "MM" big) — JPEG segment lengths stay big-endian regardless.
function exifJpeg(orientation, opts) {
  const little = (opts?.endian ?? "II") === "II";
  const u16 = (v) => (little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const tiff = [
    little ? 0x49 : 0x4d, little ? 0x49 : 0x4d, // byte order (II / MM)
    ...u16(0x2a),                                // TIFF magic (42)
    ...u32(8),                                   // offset to IFD0
    ...u16(1),                                   // one directory entry
    ...u16(0x0112),                              // tag: Orientation
    ...u16(3),                                   // type: SHORT
    ...u32(1),                                   // count
    ...u16(orientation), 0x00, 0x00,             // value (SHORT, padded to 4 bytes)
    ...u32(0),                                   // next-IFD offset (none)
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const app1Len = exif.length + 2; // includes the 2 length bytes themselves
  return new Uint8Array([
    0xff, 0xd8,                                        // SOI
    0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, // APP1 marker + length (BE)
    ...exif,
    0xff, 0xd9,                                        // EOI
  ]);
}
```

## All eight orientation values round-trip

Each of the eight defined EXIF orientations reads back exactly.

```ts
[1, 2, 3, 4, 5, 6, 7, 8].map((o) => readJpegOrientation(exifJpeg(o))).join(",")
=> 1,2,3,4,5,6,7,8
```

Big-endian ("MM") TIFF blocks parse identically — the phone that shot the photo
picks the byte order, so both must work.

```ts
[1, 2, 3, 4, 5, 6, 7, 8].map((o) => readJpegOrientation(exifJpeg(o, { endian: "MM" }))).join(",")
=> 1,2,3,4,5,6,7,8
```

## `isOrientationNormalized` is the contract predicate

Orientation 1 is normalized; a rotate/mirror value (here 6, "rotate 90° CW") is
not — the case that renders a portrait photo sideways downstream.

```ts
isOrientationNormalized(exifJpeg(1))
=> true

isOrientationNormalized(exifJpeg(6))
=> false
```

## Anything with no orientation to honor reads as normal

A JPEG with no EXIF segment, a non-JPEG (here a PNG signature), and empty bytes
all mean "nothing to correct" — the reader never throws on hostile input.

```ts
// SOI + EOI only, no APP1.
readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
=> 1

readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
=> 1

readJpegOrientation(new Uint8Array([]))
=> 1
```

An out-of-range orientation value (0 or 9 — not a defined EXIF orientation) is
ignored, degrading to normal rather than being trusted.

```ts
readJpegOrientation(exifJpeg(0))
=> 1

readJpegOrientation(exifJpeg(9))
=> 1

ORIENTATION_NORMAL
=> 1
```

## A truncated / non-EXIF APP1 doesn't crash the parse

An APP1 segment that isn't the `Exif\0\0` flavor (e.g. XMP) is skipped, and a
segment whose declared length runs past the buffer is handled without throwing.

```ts
// APP1 present but payload is "http" (XMP-like), not "Exif\0\0".
readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x68, 0x74, 0x74, 0x70, 0xff, 0xd9]))
=> 1

// APP1 claims length 0x0022 but the buffer ends immediately.
readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22]))
=> 1
```
