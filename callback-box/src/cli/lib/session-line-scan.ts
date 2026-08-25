/**
 * Find one transcript line by its entry uuid, without materializing the rest.
 *
 * This is the read half of the session-media route (`shared/session-media.ts`):
 * given `<sessionId>/<entryUuid>/<index>`, it has to get back the single line
 * that carries that image. The obvious implementation — `readline` over the
 * file, compare each entry's uuid — is exactly the shape `session-oversize.ts`
 * exists to avoid: `readline` builds a string for every line it passes,
 * including the 1.3 MB image-bearing ones, so looking up one photo would walk
 * every other photo through the heap on the way.
 *
 * So the search happens in bytes. The needle is the entry's own
 * `"uuid":"<uuid>"` field, located with `Buffer.indexOf` over fixed-size
 * chunks; only once it is found does anything become a string, and only the
 * one line does. A `parentUuid` naming the same entry cannot false-positive
 * (the needle's leading quote is preceded by `t` there, not a delimiter), and
 * the needle cannot occur inside a payload, because base64 contains neither
 * quotes nor colons.
 */

import { open, type FileHandle } from "node:fs/promises";

/** Read granularity for both the forward search and the line-bound scans. */
const CHUNK_BYTES = 256 * 1024;

/**
 * Largest line this will return as a string.
 *
 * The route materializes the whole line to reach one payload inside it, so
 * this is the endpoint's memory bound. An image-bearing turn measures ~0.7-1.3
 * MB per photo; 16 MB leaves room for a turn carrying several without letting
 * a pathological line become an allocation a request can ask for by name.
 */
export const MAX_MEDIA_LINE_BYTES = 16 * 1024 * 1024;

const NEWLINE = 0x0a;

/** Why a lookup produced no line. Distinguished because the route's answers differ. */
export type LineLookupFailure = "not-found" | "too-large";

export type LineLookupResult =
  | { found: true; line: string }
  | { found: false; reason: LineLookupFailure };

/**
 * Absolute offset of the first occurrence of `needle`, or -1.
 *
 * Chunks overlap by `needle.length - 1` bytes so a match straddling a chunk
 * boundary is still seen. The overlap is carried by rewinding the read
 * position rather than by keeping previous chunks alive.
 */
async function findNeedle(handle: FileHandle, needle: Buffer): Promise<number> {
  const overlap = needle.length - 1;
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, position);
    if (bytesRead === 0) return -1;
    const at = buffer.subarray(0, bytesRead).indexOf(needle);
    if (at !== -1) return position + at;
    if (bytesRead < CHUNK_BYTES) return -1;
    position += bytesRead - overlap;
  }
}

/**
 * Offset just past the newline that precedes `from`, i.e. the start of the
 * line containing it. Walks backwards a chunk at a time; 0 when the match is
 * on the first line.
 */
async function findLineStart(handle: FileHandle, from: number): Promise<number> {
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let end = from;
  while (end > 0) {
    const start = Math.max(0, end - CHUNK_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, end - start, start);
    if (bytesRead === 0) return 0;
    const at = buffer.subarray(0, bytesRead).lastIndexOf(NEWLINE);
    if (at !== -1) return start + at + 1;
    end = start;
  }
  return 0;
}

/**
 * Offset of the newline that ends the line containing `from`, or `size` when
 * the file's last line has no trailing newline.
 */
async function findLineEnd(handle: FileHandle, { from, size }: { from: number; size: number }): Promise<number> {
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let position = from;
  while (position < size) {
    const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, position);
    if (bytesRead === 0) return size;
    const at = buffer.subarray(0, bytesRead).indexOf(NEWLINE);
    if (at !== -1) return position + at;
    position += bytesRead;
  }
  return size;
}

/**
 * The transcript line whose entry uuid is `uuid`, as a string.
 *
 * Returns `too-large` rather than the line when it exceeds
 * {@link MAX_MEDIA_LINE_BYTES}: the caller wants one image out of it, and a
 * line that big is not one this route will allocate on a client's say-so.
 */
export async function findTranscriptLineByUuid(
  { logPath, uuid }: { logPath: string; uuid: string },
): Promise<LineLookupResult> {
  let handle: FileHandle;
  try {
    handle = await open(logPath, "r");
  } catch (_e) {
    // No transcript on disk yet (a first turn mid-flush) reads the same as an
    // unknown session to the caller: there is no image to serve either way.
    return { found: false, reason: "not-found" };
  }
  try {
    const needle = Buffer.from(`"uuid":"${uuid}"`, "utf8");
    const at = await findNeedle(handle, needle);
    if (at === -1) return { found: false, reason: "not-found" };

    const { size } = await handle.stat();
    const start = await findLineStart(handle, at);
    const end = await findLineEnd(handle, { from: at, size });
    const length = end - start;
    if (length > MAX_MEDIA_LINE_BYTES) return { found: false, reason: "too-large" };

    const line = Buffer.alloc(length);
    await handle.read(line, 0, length, start);
    return { found: true, line: line.toString("utf8") };
  } finally {
    await handle.close();
  }
}
