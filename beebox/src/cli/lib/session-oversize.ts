/**
 * The per-line byte bound on the session-log scan.
 *
 * `session-retention.ts` bounds what a scan *retains*; this bounds what it
 * *parses*. `parseSessionLog` used to `JSON.parse` every line of the transcript
 * regardless of size, so an entry-count slice did not bound bytes: prod's
 * box-family session was 15.5 MB across 1 587 lines with 14 lines over 1 MB
 * each (capture-image and tool payloads), one `chat.history` request cost
 * ~50 MB of transient heap, and concurrent identical requests stacked linearly
 * into the 1.9 GB V8 cap — four `bbx serve` OOMs on 2026-08-03/04
 * (`issues/bugs/2026-08-04-chat-history-parse-transient-oom.md`).
 *
 * A line past the threshold is never parsed. It is either dropped (when the
 * head shows it is a record the scan would have dropped anyway) or becomes a
 * stub entry: a *normal* {@link SessionEntry} — there is deliberately no new
 * entry `type`, the frontend's union is closed and narrows on it — carrying a
 * single text block, the same placeholder shape `session-content.ts` renders
 * for unknown block types.
 *
 * **What this does NOT bound:** the raw line itself. `readline` materializes a
 * whole line before anything can measure it, so a single 1.3 MB line still
 * costs 1.3 MB transiently. What the guard removes is the object graph
 * `JSON.parse` builds from it (several times the line, and *retained* when the
 * entry falls in the requested window) — the multiplier that made a burst of
 * requests fatal.
 *
 * **Accepted degradation:** a stub carries only identity, size and role, so
 * `chat/review/span.ts`'s prefix hash cannot see an oversize entry being
 * rewritten in place at the same rounded size. Detecting that would mean
 * parsing the line this module exists to refuse.
 *
 * **Accepted limitations (deliberate, not fixed):** the sniff assumes
 * Claude Code's own compact JSON encoding (`"key":"value"`, no inserted
 * whitespace) — reordered keys, pretty-printed JSON, or a marker string
 * appearing somewhere unexpected in the head can misclassify or misidentify
 * a line, and a `tool_result`-shaped user turn that also carries real text is
 * dropped whole rather than partially recovered. Image-only oversize user
 * turns surface as a visible stub even though a normally-parsed image-only
 * turn is dropped. These are accepted tradeoffs of a best-effort head sniff
 * over a real parse (2026-08 review); fixing them means parsing the line this
 * module exists to refuse.
 */

import type { SessionEntry } from "./session-entry.js";

/**
 * Longest raw transcript line the scan will parse, in UTF-8 bytes.
 *
 * 256 KB is an order of magnitude above any human-authored turn and an order
 * of magnitude below the ~1.3 MB capture payloads that caused the incident, so
 * it stubs the pathological lines without touching ordinary ones.
 */
export const MAX_SESSION_LINE_BYTES = 256 * 1024;

/** How much of an oversize line is examined to identify it. */
const SNIFF_CHARS = 2048;

/**
 * Is this line past the byte threshold?
 *
 * Measured in UTF-8 bytes, so a payload of multi-byte characters can't slip
 * under a code-unit count. The two length comparisons are the cheap decision:
 * a UTF-8 encoding is never shorter than the string's code-unit count and never
 * more than 3× it, so `Buffer.byteLength` (a full scan of the string) only runs
 * for the narrow band where the answer is genuinely in doubt.
 */
export function isOversizeLine(line: string): boolean {
  if (line.length > MAX_SESSION_LINE_BYTES) return true;
  if (line.length * 3 <= MAX_SESSION_LINE_BYTES) return false;
  return Buffer.byteLength(line, "utf8") > MAX_SESSION_LINE_BYTES;
}

/**
 * Base64 payload fields, as they appear in a raw transcript line.
 *
 * Two shapes carry image bytes: `source.data` on an inline image content block
 * (a pasted or attached photo) and `toolUseResult.file.base64` (an image a tool
 * returned). Both are plain base64 — alphabet `A-Za-z0-9+/=`, which contains no
 * character JSON escapes — so they can be matched and replaced textually
 * without the result ceasing to be valid JSON.
 *
 * The 1024-character floor keeps the match well clear of any short legitimate
 * `data` field while sitting far below a real image (the smallest photo through
 * the chat's own downscale is a few hundred KB).
 *
 * Exported because the session-media route strips the same payloads for the
 * opposite reason — it wants one of them, and blanks the rest to reach it
 * cheaply (`session-media-extract.ts`). One pattern, so "what counts as a
 * payload" cannot drift between the reader that drops them and the reader that
 * serves them. Group 1 is the key, group 2 the payload.
 */
export const BASE64_PAYLOAD_RE = /"(data|base64)":"([\d+/=A-Za-z]{1024,})"/g;

/**
 * What {@link stripInlineMedia} leaves where a payload was.
 *
 * Base64 characters only, so it stays inside the alphabet the pattern matches
 * and cannot make the line invalid JSON — and long enough to be nothing a real
 * short `data` field would hold, since a reader keys on it to decide the block
 * is a photo it can go and fetch rather than one that was never uploaded.
 */
export const STRIPPED_MEDIA_MARKER = "bbxStrippedMedia";

/**
 * Remove image payloads from a raw line, returning null when there were none.
 *
 * This is what lets an image-bearing turn be *read* rather than stubbed. A photo
 * attached in chat produces a line of roughly 0.7-1.3 MB, four to five times
 * {@link MAX_SESSION_LINE_BYTES}, so before this existed every message carrying
 * a photo came back from history as a placeholder — the text the person wrote
 * alongside it included. The bytes are what the guard exists to keep out of the
 * heap; the rest of the turn is ordinary and small.
 *
 * The payload is replaced by {@link STRIPPED_MEDIA_MARKER} rather than by an
 * empty string, so a reader can tell "we took this out" from "there was never
 * anything here". Those are different facts with different answers: the first
 * is a photo that can still be fetched from this line
 * (`shared/session-media.ts`), the second is an upload that failed and has
 * nothing behind it. Blanking both to `""` conflated them, and an entry
 * carrying one of each — a stripped photo beside a failed one — would offer
 * the failed one a URL that could only 404.
 *
 * The result is forced through a Buffer for the same reason {@link detachedHead}
 * does it: a string built from a large parent can keep that parent alive, which
 * would defeat the whole point of dropping the payload.
 */
export function stripInlineMedia(line: string): string | null {
  BASE64_PAYLOAD_RE.lastIndex = 0;
  if (!BASE64_PAYLOAD_RE.test(line)) return null;
  BASE64_PAYLOAD_RE.lastIndex = 0;
  const stripped = line.replace(BASE64_PAYLOAD_RE, `"$1":"${STRIPPED_MEDIA_MARKER}"`);
  return Buffer.from(stripped, "utf8").toString("utf8");
}

/**
 * Copy the head of an oversize line into a *detached* string.
 *
 * `line.slice(0, n)` does not copy: V8 represents the result as a sliced
 * string that keeps the whole 1.3 MB parent alive, and so does every regex
 * capture taken from it — which would leave the retained stub entries pinning
 * exactly the lines this guard refuses to parse (measured: 40 stubs held
 * ~64 MB). A Buffer round-trip forces a real copy, so the line becomes
 * garbage the moment the scan moves on.
 */
function detachedHead(line: string): string {
  return Buffer.from(line.slice(0, SNIFF_CHARS), "utf8").toString("utf8");
}

const UUID_RE = /"uuid":"([^"]*)"/;
const TIMESTAMP_RE = /"timestamp":"([^"]*)"/;

/** Read a `"key":"value"` pair out of the sniffed head, or "" if absent. */
function sniffString(head: string, re: RegExp): string {
  return re.exec(head)?.[1] ?? "";
}

/**
 * The record's top-level `type`, or null when the head doesn't show one.
 *
 * Whichever marker appears first wins: Claude Code writes the envelope before
 * `message`, so the first `"type":…` in the line is the record's own.
 */
function envelopeType(head: string): "user" | "assistant" | "system" | null {
  const candidates = [
    { type: "user", at: head.indexOf("\"type\":\"user\"") },
    { type: "assistant", at: head.indexOf("\"type\":\"assistant\"") },
    { type: "system", at: head.indexOf("\"type\":\"system\"") },
  ] as const;
  const found = candidates.filter((c) => c.at !== -1);
  if (found.length === 0) return null;
  return found.reduce((a, b) => (a.at <= b.at ? a : b)).type;
}

/**
 * What a line too large to parse contributes to the scan: a placeholder entry,
 * or null to drop it.
 *
 * Only the first {@link SNIFF_CHARS} are examined. That is enough to recognize
 * the records `buildEntry` would itself have dropped — system messages, SDK
 * meta prompts, synthetic assistant turns, and the tool_result plumbing turns
 * that are the commonest fat lines of all — so an oversize one of those doesn't
 * become a visible message (and a spurious `total`) that the parsed version
 * never was.
 *
 * The sniff is best-effort by construction: a shape it can't recognize in the
 * head becomes a stub rather than a silent drop, because an unexplained gap in
 * the transcript is the worse failure. For the same reason an unattributed stub
 * is the assistant's — a `user` stub would be a lie the tail-window floor could
 * act on (`isRealUserMessage` rejects stubs either way).
 *
 * `lineNumber` (1-based, the line's position in the transcript) backs a
 * fallback identity when the sniff can't find a `uuid` in the head: several
 * empty-uuid stubs in the same scan would otherwise collide as React keys
 * (`MessageList` keys entries by uuid) and on the `appliedSpanFor()` journal
 * boundary. The line number is stable across re-scans of the same file, so
 * the fallback id doesn't change from one request to the next.
 */
export function oversizeEntry(line: string, lineNumber: number): SessionEntry | null {
  const head = detachedHead(line);
  const type = envelopeType(head);
  if (type === "system") return null;
  if (head.includes("\"isMeta\":true")) return null;
  if (type === "assistant" && head.includes("\"model\":\"<synthetic>\"")) return null;
  // A user turn whose content opens with a tool_result is API plumbing:
  // `classifyUserEntry` drops it, and so do we.
  if (type === "user" && head.includes("\"type\":\"tool_result\"")) return null;

  const kb = Math.round(Buffer.byteLength(line, "utf8") / 1024);
  const uuid = sniffString(head, UUID_RE);
  return {
    uuid: uuid !== "" ? uuid : `oversize-${String(lineNumber)}`,
    type: type === "user" ? "user" : "assistant",
    timestamp: sniffString(head, TIMESTAMP_RE),
    content: [{ type: "text", text: `[message too large to display: ~${String(kb)} KB]` }],
  };
}
