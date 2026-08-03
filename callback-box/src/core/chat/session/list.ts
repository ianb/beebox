/**
 * The one enumeration of "which web chats exist".
 *
 * Husk cards are the source of truth (docs/plans/chat-husks.md) — the cards
 * say which sessions exist and what they're called, so deleting a husk is
 * editorial removal from every list. Activity stays runtime-derived: freshness
 * is the transcript's mtime, and a husk whose transcript is gone is skipped
 * here (nothing to resume) while staying browsable as a card.
 *
 * Extracted from `webapp/trpc/routers/chat.ts` so the history dropdown
 * (`chat.sessions`) and the landmark picker (`chat.byLandmark`) enumerate the
 * same set. The dropdown used to read the history JSON instead, so a deleted
 * husk vanished from the picker but lingered in the dropdown.
 */

import * as fs from "node:fs/promises";
import { findChatHuskEntry, listChatHusks } from "../husk.js";
import { huskTranscriptPath } from "../husk-transcript.js";
import { resolveSessionLabel } from "../session-label.js";
import { errnoCode } from "../../../lib/error-guards.js";

export interface ChatSessionRow {
  sessionId: string;
  /** "" for root-bound, undefined for legacy unbound (treated as root). */
  contextDir: string | undefined;
  mtime: Date;
  label: string;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
}

/** Every resumable web chat, most-recently-active first. */
export async function loadAllSessions(boxRoot: string): Promise<ChatSessionRow[]> {
  const husks = await listChatHusks(boxRoot);
  const rows: ChatSessionRow[] = [];
  for (const husk of husks) {
    const logPath = huskTranscriptPath(boxRoot, husk);
    let mtime: Date;
    try {
      mtime = (await fs.stat(logPath)).mtime;
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        // Not "the transcript was cleaned up" — the file may well be there and
        // unreadable (EACCES, EIO). Dropping the chat from every list is the
        // same outcome either way, so say so loudly rather than silently.
        console.warn(`[chat] husk ${husk.path}: transcript unreadable, omitting session:`, e);
      }
      // Nothing to resume — skip it. The husk card stays browsable.
      continue;
    }

    const label = await resolveSessionLabel({
      sessionId: husk.session,
      logPath,
      title: husk.title,
    });

    rows.push({
      sessionId: husk.session,
      contextDir: husk.contextDir,
      mtime,
      label,
      huskPath: husk.path,
    });
  }
  rows.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return rows;
}

/**
 * One session's display label, resolved the way `loadAllSessions` resolves a
 * row's — husk `title`, then the transcript's first user message, then the id
 * prefix — but for a single known id, so the chat page's bootstrap doesn't pay
 * for enumerating every chat in the box just to name the one it's showing.
 *
 * A session with no husk still gets a label: a brand-new chat is named from its
 * transcript, and an id with neither is named from its prefix (not an error —
 * `chat.bootstrap` already treats a transcript-less id as a normal state).
 */
/**
 * The session's *editorial* title — the husk card's `title`, or null when
 * the session has none (yet). Deliberately no first-message/id fallback:
 * those fabrications are fine as picker-row labels where every row must be
 * distinguishable, but the app bar's session chip shows a title only when a
 * real one exists (the nightly chat review or a hand edit names it) and an
 * icon face otherwise.
 */
export async function titleForSession(boxRoot: string, sessionId: string): Promise<string | null> {
  const husk = await findChatHuskEntry(boxRoot, sessionId);
  const title = husk?.title;
  return title === undefined || title === "" ? null : title;
}
