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
import { findChatHuskEntry, listChatHusks, type ChatHuskEntry } from "../husk.js";
import { huskTranscriptPath } from "../husk-transcript.js";
import { resolveSessionLabel } from "../session-label.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { mapInBatches, mapInBatchesSettled } from "../../../lib/map-batched.js";

/**
 * Chats resolved at once — see {@link mapInBatchesSettled}. `resolveSessionLabel`
 * absorbs its own failures (it falls back to the id prefix), so the labelling
 * pass can use the plain `mapInBatches`.
 */
const READ_CONCURRENCY = 64;

/**
 * A chat's *identity and activity* — everything derivable from its husk card
 * plus one `stat`. Deliberately unlabeled: naming a chat can cost a transcript
 * read, and a caller that only counts chats must not pay for names it discards.
 */
export interface ChatSessionEntry {
  sessionId: string;
  /** "" for root-bound, undefined for legacy unbound (treated as root). */
  contextDir: string | undefined;
  mtime: Date;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
  /**
   * Absolute transcript path. Carried rather than recomputed: the enumeration
   * already resolved it to `stat` the file, and labelling would otherwise
   * re-derive it. Host-side only — never forwarded to a client.
   */
  logPath: string;
  /** The husk's editorial `title`, when it has one. Free — it rode the husk. */
  title: string | undefined;
}

/** A chat as a *list* shows it — an entry plus its display name. */
export interface ChatSessionRow extends ChatSessionEntry {
  label: string;
}

/**
 * Every resumable web chat, most-recently-active first, **without labels**.
 *
 * This is the cheap enumeration: one husk read and one `stat` per chat, no
 * transcript I/O. Use it whenever you need to know *which* chats exist, where
 * they're bound, or how recently they were touched — grouping, counting,
 * freshness — and reach for `loadAllSessions` only when rows will actually be
 * rendered with names.
 *
 * Husks are resolved concurrently, not in sequence: the app bar's place menu
 * waits on the whole set. `allSettled` per code-style — one husk's failure is
 * already a per-husk skip, and must not abandon the others.
 */
export async function listSessionEntries(boxRoot: string): Promise<ChatSessionEntry[]> {
  const husks = await listChatHusks(boxRoot);
  const settled = await mapInBatchesSettled(husks, {
    size: READ_CONCURRENCY,
    map: (husk) => loadSessionEntry(boxRoot, husk),
  });
  const entries: ChatSessionEntry[] = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.warn(`[chat] husk ${husks[i]?.path}: could not resolve session:`, outcome.reason);
      continue;
    }
    if (outcome.value !== null) entries.push(outcome.value);
  }
  entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return entries;
}

/**
 * Every resumable web chat, most-recently-active first, each with the label a
 * list shows (husk `title`, then the transcript's first user message, then the
 * id prefix). The naming half is what costs I/O — see `listSessionEntries` for
 * the enumeration on its own.
 */
export async function loadAllSessions(boxRoot: string): Promise<ChatSessionRow[]> {
  const entries = await listSessionEntries(boxRoot);
  // Bounded: an untitled chat's label comes from a transcript read, so this is
  // one open stream per chat and a box's chat count only ever grows.
  return mapInBatches(entries, {
    size: READ_CONCURRENCY,
    map: async (entry) => ({
      ...entry,
      label: await resolveSessionLabel({
        sessionId: entry.sessionId,
        logPath: entry.logPath,
        title: entry.title,
      }),
    }),
  });
}

/** One husk's entry, or null when there's no transcript left to resume. */
async function loadSessionEntry(boxRoot: string, husk: ChatHuskEntry): Promise<ChatSessionEntry | null> {
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
    return null;
  }

  return {
    sessionId: husk.session,
    contextDir: husk.contextDir,
    mtime,
    huskPath: husk.path,
    logPath,
    title: husk.title,
  };
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
