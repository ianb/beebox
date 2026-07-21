/**
 * The image-orientation contract, in one place.
 *
 * Photos carry an EXIF *orientation* tag (values 1–8: rotations and mirrors) so
 * a camera can store sensor-native pixels and let the viewer rotate. That only
 * works if every downstream decoder honors the tag — and across the ingress
 * paths images take into a box (browser paste/drop/file, browser camera, native
 * camera/gallery, capture uploads, stored files, model input) some re-render
 * pixels while others forward the source bytes, so a tag that one boundary drops
 * makes a photo that looked upright at capture render rotated later.
 *
 * The invariant this module defines and lets callers check: **an image at rest
 * inside a box is orientation-normalized** — its pixels are already upright and
 * it carries no non-trivial EXIF orientation (value 1, or none). Every path that
 * *transcodes* must bake the orientation into pixels and emit a value-1 / absent
 * tag (a canvas re-encode does this for free; native clients redraw upright
 * before compressing). This reader is the oracle: it extracts the EXIF
 * orientation so a boundary can assert normalization (or flag a violation), and
 * a normalized image always reads back as {@link ORIENTATION_NORMAL}.
 *
 * Pure and dependency-free (operates on a byte view), so it is shared by the
 * backend ingress guards and the frontend transcode path alike.
 */

/** EXIF orientation for an upright image needing no rotation. Also what a
 *  non-JPEG, a JPEG without EXIF, or an unparseable header reads back as — the
 *  safe default is "nothing to correct." */
export const ORIENTATION_NORMAL = 1;

/** Read `bytes[i]`, or 0 past the end. Callers bound-check before it matters;
 *  the coalesce only satisfies `noUncheckedIndexedAccess` (an out-of-range read
 *  degrades the parse to "no orientation" rather than throwing). */
function byteAt(bytes: Uint8Array, i: number): number {
  return bytes[i] ?? 0;
}

/**
 * Extract the EXIF orientation (1–8) from a JPEG's bytes, or
 * {@link ORIENTATION_NORMAL} when there is none to honor (not a JPEG, no EXIF
 * segment, no Orientation tag, or a malformed header — all mean "render as-is").
 *
 * Only the leading segments need to be present: EXIF (APP1) always precedes the
 * scan data, so a bounded prefix of the file is enough to read the tag.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  // Not a JPEG (SOI = FFD8) → no EXIF orientation applies.
  if (bytes.length < 4 || byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) {
    return ORIENTATION_NORMAL;
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    // Markers are FF-prefixed; skip any fill bytes between segments.
    if (byteAt(bytes, offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = byteAt(bytes, offset + 1);
    // SOI / EOI are standalone (no length word); a fill FF repeats the marker.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xff) {
      offset += 2;
      continue;
    }
    // Start of scan: entropy-coded data follows and EXIF always precedes it.
    if (marker === 0xda) break;
    const segLen = (byteAt(bytes, offset + 2) << 8) | byteAt(bytes, offset + 3);
    if (segLen < 2) break;
    if (marker === 0xe1) {
      const orientation = parseExifOrientation(bytes, { start: offset + 4, length: segLen - 2 });
      if (orientation !== null) return orientation;
    }
    offset += 2 + segLen;
  }
  return ORIENTATION_NORMAL;
}

/** True when the bytes carry no non-trivial EXIF orientation — i.e. the image is
 *  already upright at rest, the contract this module enforces. */
export function isOrientationNormalized(bytes: Uint8Array): boolean {
  return readJpegOrientation(bytes) === ORIENTATION_NORMAL;
}

const EXIF_TAG_ORIENTATION = 0x0112;
const TIFF_TYPE_SHORT = 3;

/** Parse an APP1 payload (`start` .. `start+length`) for the EXIF Orientation
 *  tag. Returns 1–8, or null when this isn't a well-formed EXIF/TIFF block or
 *  carries no Orientation entry. */
function parseExifOrientation(bytes: Uint8Array, span: { start: number; length: number }): number | null {
  const { start, length } = span;
  const end = Math.min(start + length, bytes.length);
  // "Exif\0\0" identifies the APP1 flavor that carries the TIFF block.
  if (end - start < 6) return null;
  const exifMagic = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (const [i, expected] of exifMagic.entries()) {
    if (byteAt(bytes, start + i) !== expected) return null;
  }
  const tiff = start + 6;
  if (tiff + 8 > end) return null;

  const b0 = byteAt(bytes, tiff);
  const b1 = byteAt(bytes, tiff + 1);
  let little: boolean;
  if (b0 === 0x49 && b1 === 0x49) little = true; // "II" — Intel / little-endian
  else if (b0 === 0x4d && b1 === 0x4d) little = false; // "MM" — Motorola / big-endian
  else return null;

  const u16 = (o: number): number =>
    little ? byteAt(bytes, o) | (byteAt(bytes, o + 1) << 8) : (byteAt(bytes, o) << 8) | byteAt(bytes, o + 1);
  const u32 = (o: number): number => {
    const v = little
      ? byteAt(bytes, o) | (byteAt(bytes, o + 1) << 8) | (byteAt(bytes, o + 2) << 16) | (byteAt(bytes, o + 3) << 24)
      : (byteAt(bytes, o) << 24) | (byteAt(bytes, o + 1) << 16) | (byteAt(bytes, o + 2) << 8) | byteAt(bytes, o + 3);
    return v >>> 0;
  };

  // TIFF magic (42) then the offset (from the TIFF header) to IFD0.
  if (u16(tiff + 2) !== 0x2a) return null;
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return null;

  const entryCount = u16(ifd0);
  for (let i = 0; i < entryCount; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) !== EXIF_TAG_ORIENTATION) continue;
    // Orientation is a single SHORT stored inline in the value field.
    if (u16(entry + 2) !== TIFF_TYPE_SHORT) return null;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}
