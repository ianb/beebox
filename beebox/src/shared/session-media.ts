/**
 * Addressing for an inline image that lives in a session transcript.
 *
 * A photo attached in chat is written by the Claude Code subprocess as base64
 * inside the transcript's own JSONL line, and nowhere else — there is no copy
 * in the box (`session-oversize.ts`). The history path deliberately refuses to
 * carry those bytes: `stripInlineMedia` removes them mid-scan so a 1.3 MB line
 * costs an ordinary parse instead of the multi-MB one that OOM'd production
 * (`issues/closed/bugs/2026-08-04-chat-history-parse-transient-oom.md`).
 *
 * The bytes are still on disk, though, so the stripped block does not have to
 * become a dead placeholder. It becomes a *reference*: the reader emits the
 * coordinates of the payload it skipped, and the browser fetches that one image
 * from `/api/session-media/<ref>` only if it is ever actually looked at. The
 * cost moves off every history read and onto a per-image request that a
 * scrolled-past photo never makes.
 *
 * The coordinates are `<sessionId>/<entryUuid>/<index>`:
 *
 * - `sessionId` names the transcript (resolved through the box's own session
 *   history, so a landmark-bound chat's non-root cwd resolves correctly).
 * - `entryUuid` names the line, and survives everything a byte offset would
 *   not — it is the identity the transcript itself carries.
 * - `index` is the ordinal of the image among that entry's image blocks, in
 *   document order. Reader and server enumerate the same array the same way.
 *
 * The two ids are constrained to `[A-Za-z0-9_-]` on the way back in. They are
 * interpolated into a filesystem path (`getSessionLogPath`), so excluding `.`
 * and `/` is what keeps a crafted ref from walking out of the projects
 * directory — the check belongs here, at the parse boundary, rather than in
 * each caller.
 */

/** URL segment the media route is mounted at, under the box-scoped API base. */
export const SESSION_MEDIA_ROUTE = "session-media";

/**
 * Most images we will address in one entry. An entry with more image blocks
 * than this is not a conversation turn we need to serve inline, and the bound
 * keeps a crafted ref from asking the server to walk an unbounded array.
 */
const MAX_IMAGE_INDEX = 999;

/** Ids may not contain `.` or `/`: both ids land in a filesystem path. */
const SAFE_ID_RE = /^[\w-]{1,64}$/;

export interface SessionMediaRef {
  sessionId: string;
  entryUuid: string;
  index: number;
}

/** Encode a reference into its `<sessionId>/<entryUuid>/<index>` path form. */
export function encodeSessionMediaRef(ref: SessionMediaRef): string {
  return `${ref.sessionId}/${ref.entryUuid}/${String(ref.index)}`;
}

/**
 * Parse a reference, or null when it is not one this server will act on.
 *
 * Null covers every rejection — wrong arity, an id carrying a path character,
 * a non-integer or out-of-range index — because the caller's answer to all of
 * them is the same 400. There is nothing a client could do differently with a
 * more specific complaint, and naming which check failed would describe the
 * filesystem layout to someone probing it.
 */
export function parseSessionMediaRef(raw: string): SessionMediaRef | null {
  const parts = raw.split("/");
  if (parts.length !== 3) return null;
  const [sessionId = "", entryUuid = "", rawIndex = ""] = parts;
  if (!SAFE_ID_RE.test(sessionId) || !SAFE_ID_RE.test(entryUuid)) return null;
  if (!/^\d{1,3}$/.test(rawIndex)) return null;
  const index = Number(rawIndex);
  if (index > MAX_IMAGE_INDEX) return null;
  return { sessionId, entryUuid, index };
}
