/**
 * The newest live session bound to a directory. Kept apart from `history.ts`
 * because it asks the native session store, which itself reads history.
 */

import * as fs from "node:fs/promises";
import { loadHistoryEntries, sessionLogPathFor, type SessionHistoryEntry } from "./history.js";
import { SESSION_STORES } from "./native-store.js";

/**
 * Whether the entry's transcript is on this machine. Any failure reads as
 * absent: the rejection only tells us the transcript cannot be reached, which
 * is the signal the ghost check wants. Claude's file is checked at the path
 * this entry names rather than through the store, which would re-read the
 * history file once per entry.
 */
async function hasTranscript(boxRoot: string, entry: SessionHistoryEntry): Promise<boolean> {
  const present = entry.engine === "claude"
    ? fs.access(sessionLogPathFor(boxRoot, entry)).then(() => true)
    : SESSION_STORES[entry.engine].updatedAt(boxRoot, entry.id).then((at) => at !== null);
  return present.catch(() => false);
}

/**
 * Find the most-recently-created session associated with a directory.
 * "Most recent" means later in the history file's session list — entries
 * are appended in creation order, so the last match wins.
 *
 * Pre-landmark sessions have no recorded `contextDir`. They're treated
 * as box-root chats, so a query for `""` (the root binding) matches
 * both empty-string entries and entries with no `contextDir` at all.
 */
export async function getLastSessionForDirectory(boxRoot: string, contextDir: string): Promise<string | null> {
  const entries = await loadHistoryEntries(boxRoot);
  // Walk newest → oldest and skip ghost entries — history rows are written
  // when the SDK first assigns an id (before any output is committed), so a
  // turn that errors immediately leaves an entry pointing at a JSONL that
  // never gets created. Returning the ghost id sends the user to a chat the
  // SDK can't resume and silently fails. fs.access is cheap relative to
  // user-facing latency on a "Chat" click.
  //
  // Testing caveat: this means tests that exercise this helper can't just
  // call appendHistory — they must also seed an empty JSONL at the path
  // resolveSessionLogPath() produces, or every entry looks like a ghost and
  // the helper returns null. See test/core/chat/session/history.test.ts's
  // seedSessionLog/cleanupSessionLogs helpers.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) continue;
    const matches = entry.contextDir === contextDir || (contextDir === "" && entry.contextDir === undefined);
    if (!matches) continue;
    if (await hasTranscript(boxRoot, entry)) return entry.id;
    // Ghost entry — no transcript. A recurring ghost-creation bug shows up as
    // repeated skips for the same id across sessions.
    console.warn(`[chat-session-history] Skipping ghost ${entry.engine} entry for ${contextDir === "" ? "<root>" : contextDir}: ${entry.id}`);
  }
  return null;
}
