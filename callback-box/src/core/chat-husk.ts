/**
 * Chat husks — a `chat` card per web chat session (docs/plans/chat-husks.md).
 *
 * The husk is the session's noun: identity (`session` id, `context-dir`)
 * plus editorial fields, created eagerly at session-id assignment and
 * backfilled once for pre-husk history. Activity/freshness deliberately
 * stays in runtime bookkeeping — the card never changes just because the
 * conversation continued.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createChatHuskTemplate } from "../schemas/chat.js";
import { loadHistoryEntries, resolveSessionLogPath } from "./chat-session-history.js";
import { getSessionMetadata } from "../cli/lib/session.js";

export const CHAT_HUSK_DIR = "store/chat/web";
const BACKFILL_MARKER = ".callback-box/chat-husks-backfilled";
/** Keep husk titles bookmark-sized, not transcript-sized. */
const TITLE_MAX_LEN = 80;

function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** `2026-07-02_59fc20dd.chat.card` — date names the file; the suffix is the idempotency key. */
function huskFileName(sessionId: string, date: Date): string {
  return `${date.toISOString().slice(0, 10)}_${shortId(sessionId)}.chat.card`;
}

/**
 * Find an existing husk for a session, by the `_<shortid>.chat.card`
 * filename suffix (rename-tolerant as long as the suffix survives; a
 * fully renamed husk is fine too — it just won't be found here, and
 * ensure would create a duplicate pointer, which validation of the
 * `session` field makes discoverable rather than harmful).
 */
export async function findChatHusk(boxRoot: string, sessionId: string): Promise<string | null> {
  const suffix = `_${shortId(sessionId)}.chat.card`;
  let names: string[];
  try {
    names = await fs.readdir(path.join(boxRoot, CHAT_HUSK_DIR));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const match = names.find((n) => n.endsWith(suffix));
  return match === undefined ? null : `${CHAT_HUSK_DIR}/${match}`;
}

/** Best-effort title from the transcript's first user message; null when unavailable. */
async function readSnippetTitle(boxRoot: string, sessionId: string): Promise<string | null> {
  try {
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    const meta = await getSessionMetadata({ sessionId, logPath, snippetMaxLen: TITLE_MAX_LEN });
    const snippet = meta.firstUserSnippet?.trim();
    return snippet !== undefined && snippet !== "" ? snippet : null;
  } catch (_e) {
    // No transcript yet (brand-new session) or unreadable — the husk starts
    // untitled; enrichment is editorial, not plumbing.
    return null;
  }
}

/**
 * Ensure a husk card exists for a session; returns its box-relative path.
 * Idempotent. `date` names the file (defaults to now; backfill passes the
 * transcript mtime so old husks sort by when the chat happened).
 */
export async function ensureChatHusk(
  boxRoot: string,
  opts: { sessionId: string; contextDir?: string; date?: Date },
): Promise<string> {
  const existing = await findChatHusk(boxRoot, opts.sessionId);
  if (existing !== null) return existing;

  const title = await readSnippetTitle(boxRoot, opts.sessionId);
  const relPath = `${CHAT_HUSK_DIR}/${huskFileName(opts.sessionId, opts.date ?? new Date())}`;
  const absPath = path.join(boxRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const content = createChatHuskTemplate({
    session: opts.sessionId,
    ...(opts.contextDir !== undefined ? { contextDir: opts.contextDir } : {}),
    ...(title !== null ? { title } : {}),
  });
  // `wx` so a concurrent ensure can't clobber; losing the race is success.
  try {
    await fs.writeFile(absPath, content, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return relPath;
}

/**
 * One-shot husk backfill for pre-husk sessions in the history file.
 * Ghost entries (no transcript on disk) are skipped — nothing to point
 * at. Gated by a marker file; safe to call on every server boot.
 */
export async function backfillChatHusks(boxRoot: string): Promise<void> {
  const marker = path.join(boxRoot, BACKFILL_MARKER);
  try {
    await fs.access(marker);
    return;
  } catch (_e) {
    // Marker absent — this is the run.
  }
  const entries = await loadHistoryEntries(boxRoot);
  for (const entry of entries) {
    let mtime: Date;
    try {
      const logPath = await resolveSessionLogPath(boxRoot, entry.id);
      mtime = (await fs.stat(logPath)).mtime;
    } catch (_e) {
      // Ghost entry — transcript gone; no husk.
      continue;
    }
    await ensureChatHusk(boxRoot, {
      sessionId: entry.id,
      ...(entry.contextDir !== undefined ? { contextDir: entry.contextDir } : {}),
      date: mtime,
    });
  }
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, `${new Date().toISOString()}\n`);
}
