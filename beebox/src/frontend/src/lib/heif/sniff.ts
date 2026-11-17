/**
 * Recognize HEIF-family image bytes (HEIC off an iPhone, HEIF) by their
 * container header, so the composer loads the WebAssembly decoder only for a
 * file that can use it.
 *
 * The bytes decide, not the MIME type or the name: a pasted image often
 * arrives with an empty `type`, and a renamed file keeps its old extension.
 * Every HEIF file opens with an ISO-BMFF `ftyp` box: a 4-byte size, the ASCII
 * `ftyp`, then a 4-byte major brand.
 */

/**
 * Major brands libheif reads as HEIF still images or sequences. `mif1`/`msf1`
 * are generic and also open AVIF files; a browser that reaches the HEIF path
 * has already failed its native decode, so an AVIF there is unreadable either
 * way and libheif's own error decides.
 */
const HEIF_BRANDS: ReadonlySet<string> = new Set([
  "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1",
]);

/** Bytes needed to read the `ftyp` box's major brand. */
export const HEIF_SNIFF_BYTES = 12;

/** True when `head` (the file's first bytes) opens a HEIF-family container. */
export function isHeifHeader(head: Uint8Array): boolean {
  if (head.length < HEIF_SNIFF_BYTES) return false;
  const ascii = (from: number, to: number) => String.fromCodePoint(...head.subarray(from, to));
  return ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12));
}

/** Read `blob`'s header and test it with {@link isHeifHeader}. */
export async function isHeifBlob(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, HEIF_SNIFF_BYTES).arrayBuffer());
  return isHeifHeader(head);
}
