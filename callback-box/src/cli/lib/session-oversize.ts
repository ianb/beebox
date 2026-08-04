/**
 * The per-line byte bound on the session-log scan.
 *
 * `session-retention.ts` bounds what a scan *retains*; this bounds what it
 * *allocates*. `parseSessionLog` used to `JSON.parse` every line of the
 * transcript regardless of size, so an entry-count slice did not bound bytes:
 * prod's box-family session was 15.5 MB across 1 587 lines with 14 lines over
 * 1 MB each (capture-image and tool payloads), one `chat.history` request cost
 * ~50 MB of transient heap, and concurrent identical requests stacked linearly
 * into the 1.9 GB V8 cap — four `cb serve` OOMs on 2026-08-03/04
 * (`issues/bugs/2026-08-04-chat-history-parse-transient-oom.md`).
 *
 * A line past the threshold is never parsed. It becomes a stub entry instead:
 * a *normal* {@link SessionEntry} (there is deliberately no new entry `type` —
 * the frontend's union is closed and narrows on it) carrying a single text
 * block, the same placeholder shape `session-content.ts` renders for unknown
 * block types.
 */

import type { SessionEntry } from "./session-entry.js";

/**
 * Longest raw transcript line the scan will parse.
 *
 * 256 KB is an order of magnitude above any human-authored turn and an order
 * of magnitude below the ~1.3 MB capture payloads that caused the incident, so
 * it stubs the pathological lines without touching ordinary ones.
 *
 * The scan compares this against `line.length` — UTF-16 code units, not bytes.
 * A UTF-8 encoding is never *shorter* than its code-unit count, so a line long
 * enough to trip the test is always past the byte threshold too, and code
 * units are the better proxy for the heap a parsed line occupies anyway.
 */
export const MAX_SESSION_LINE_BYTES = 256 * 1024;

/** How much of an oversize line is examined to identify it. */
const SNIFF_CHARS = 2048;

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
 * Build the placeholder entry for a line too large to parse.
 *
 * Only the first {@link SNIFF_CHARS} of the line are examined — Claude Code
 * writes the envelope fields (`type`, `uuid`, `timestamp`) before `message`,
 * so the identity survives without touching the payload. The entry type falls
 * back to `assistant` when neither marker is in the head: an unattributed
 * placeholder reads better as the assistant's than as the human's, and a
 * `user` stub would be a lie the tail-window floor could act on.
 */
export function oversizeStubEntry(line: string): SessionEntry {
  const head = detachedHead(line);
  const userAt = head.indexOf("\"type\":\"user\"");
  const assistantAt = head.indexOf("\"type\":\"assistant\"");
  const isUser = userAt !== -1 && (assistantAt === -1 || userAt < assistantAt);
  const kb = Math.round(line.length / 1024);
  return {
    uuid: sniffString(head, UUID_RE),
    type: isUser ? "user" : "assistant",
    timestamp: sniffString(head, TIMESTAMP_RE),
    content: [{ type: "text", text: `[message too large to display: ~${String(kb)} KB]` }],
  };
}
