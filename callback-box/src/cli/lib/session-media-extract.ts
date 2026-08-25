/**
 * Pull ONE inline image out of a transcript line.
 *
 * The line is the fat thing the history path refuses to parse — up to megabytes
 * of base64 — and the route wants a single photo from inside it. `JSON.parse`
 * on the raw line would work and would also rebuild every payload in it as an
 * object graph several times the line's size: the exact allocation
 * `session-oversize.ts` was written to prevent, re-entered through a different
 * door.
 *
 * So the payloads come out textually first, and the *structure* is parsed
 * without them. Each payload is replaced by a short {@link slotToken}, which
 * makes the parsed line small and leaves an unambiguous marker where the bytes
 * used to be — so the image block found by walking the structure names its own
 * payload directly, rather than the two being matched up by counting. Only the
 * one requested payload is then decoded.
 *
 * Scope: image blocks in `message.content`, which is where a photo attached in
 * chat lands. A `toolUseResult.file.base64` (an image the Read tool returned)
 * is stripped by the same pattern but is not addressed here — that file exists
 * in the box and belongs behind `/api/image/*`, not behind a transcript offset.
 */

import { BASE64_PAYLOAD_RE } from "./session-oversize.js";
import { isRecord } from "../../lib/is-record.js";

/**
 * Stand-in written where a payload was.
 *
 * Distinctive on purpose: it has to be a value no real `data`/`base64` field
 * would hold, since finding it is how an image block is matched to its bytes.
 * It is also short, which is the point — the parsed line costs the structure
 * only, not the photographs. Every character is JSON-safe, so swapping it in
 * between the quotes leaves the document parseable.
 */
const SLOT_PREFIX = "cb-media-slot-";

function slotToken(index: number): string {
  return `${SLOT_PREFIX}${String(index)}`;
}

/**
 * Media types this will hand back.
 *
 * The `media_type` comes out of the transcript, and the route puts it straight
 * into a `Content-Type`. That is a value a box's own conversation can contain,
 * so it is not attacker-controlled in any ordinary sense — but "the bytes are
 * an image" is the whole contract here, and an allowlist is the difference
 * between a wrong photo and a response a browser might treat as a document.
 * Anything else degrades to `application/octet-stream`, which renders nothing.
 */
const SERVABLE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

/** An image resolved out of a transcript line, ready to serve. */
export interface ExtractedMedia {
  mediaType: string;
  bytes: Buffer;
}

/** Why an extraction found nothing. The route answers these differently. */
export type ExtractFailure = "unparsable" | "no-such-image" | "no-payload";

export type ExtractResult =
  | { ok: true; media: ExtractedMedia }
  | { ok: false; reason: ExtractFailure };

/** Where one payload sits in the original line. */
interface PayloadSlot {
  start: number;
  end: number;
}

/**
 * Replace every payload with its slot token, remembering only where each one
 * WAS.
 *
 * Offsets, not copies. A turn carrying three photos would otherwise leave this
 * function holding three multi-megabyte strings so that one of them could be
 * decoded — three times the memory for the same answer, on a route whose whole
 * justification is keeping image bytes off the general read path. With offsets
 * the only payload ever materialized is the one asked for.
 *
 * The result is still valid JSON: base64 uses no character JSON escapes, and
 * neither does the token, so a textual swap inside the quotes cannot break the
 * document (the same property `stripInlineMedia` relies on).
 */
function detachPayloads(line: string): { structure: string; slots: PayloadSlot[] } {
  const slots: PayloadSlot[] = [];
  const parts: string[] = [];
  let cursor = 0;
  BASE64_PAYLOAD_RE.lastIndex = 0;
  for (;;) {
    const match = BASE64_PAYLOAD_RE.exec(line);
    if (match === null) break;
    const [whole, key = "", payload = ""] = match;
    // The payload sits inside the match, after `"<key>":"`.
    const start = match.index + whole.length - payload.length - 1;
    const index = slots.push({ start, end: start + payload.length }) - 1;
    parts.push(line.slice(cursor, match.index), `"${key}":"${slotToken(index)}"`);
    cursor = match.index + whole.length;
  }
  parts.push(line.slice(cursor));
  return { structure: parts.join(""), slots };
}

/** The `message.content` array of a parsed transcript record, or null. */
function messageContent(record: unknown): unknown[] | null {
  if (!isRecord(record)) return null;
  const message = record["message"];
  if (!isRecord(message)) return null;
  const content = message["content"];
  return Array.isArray(content) ? content : null;
}

/**
 * The `source` object of the `index`-th image block, or null when the entry
 * has no such image. Counts image blocks only, in document order — the same
 * enumeration `transformContent` uses to mint the reference.
 */
function imageSourceAt(content: unknown[], index: number): Record<string, unknown> | null {
  let seen = 0;
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "image") continue;
    if (seen === index) {
      const source = block["source"];
      return isRecord(source) ? source : null;
    }
    seen += 1;
  }
  return null;
}

/** Which detached payload this source's `data` field holds, or -1. */
function slotIndexOf(source: Record<string, unknown>): number {
  const data = source["data"];
  if (typeof data !== "string" || !data.startsWith(SLOT_PREFIX)) return -1;
  const index = Number(data.slice(SLOT_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

/**
 * Resolve the `index`-th image of a transcript line to bytes.
 *
 * `no-payload` is a real and expected answer, distinct from `no-such-image`:
 * an image block whose bytes never arrived (a failed upload) parses fine and
 * simply has nothing behind it. The caller must not present that as the same
 * thing as a photo it could not find.
 */
export function extractSessionMedia(
  { line, index }: { line: string; index: number },
): ExtractResult {
  const { structure, slots } = detachPayloads(line);

  let record: unknown;
  try {
    record = JSON.parse(structure);
  } catch (_e) {
    // A line the transcript writer left half-flushed, or a shape the payload
    // swap did not survive. Either way there is no image to serve from it.
    return { ok: false, reason: "unparsable" };
  }

  const content = messageContent(record);
  if (content === null) return { ok: false, reason: "no-such-image" };
  const source = imageSourceAt(content, index);
  if (source === null) return { ok: false, reason: "no-such-image" };

  const slot = slotIndexOf(source);
  const found = slot === -1 ? undefined : slots[slot];
  if (found === undefined) return { ok: false, reason: "no-payload" };

  const declared = source["media_type"];
  const mediaType = typeof declared === "string" && SERVABLE_MEDIA_TYPES.has(declared)
    ? declared
    : "application/octet-stream";
  // The one payload this whole function exists to reach, cut from the line and
  // decoded exactly once.
  return {
    ok: true,
    media: { mediaType, bytes: Buffer.from(line.slice(found.start, found.end), "base64") },
  };
}
