/**
 * Per-session "since my last reply" anchor for the `cb chat whats-changed`
 * command. After each completed chat turn the session records the git HEAD it
 * left the box at; the command diffs `marker.head..HEAD` (committed) plus the
 * current working tree (uncommitted) to tell the agent what changed in the box
 * — and, scoped by `--card`, in the open companion card — since it last spoke.
 *
 * Stored one file per session at `.callback-box/chat-turn-marker/<id>.json`.
 * Writes are synchronous (the recording path awaits HEAD then writes before
 * the queue drains, so the next turn can't race ahead of the marker) and all
 * reads degrade to `null` rather than throwing — a missing/corrupt marker just
 * means "first turn", which the command handles with a labeled fallback.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getHeadSha } from "../../lib/git-range.js";
import { isRecord } from "../card-io.js";

const MARKER_DIR = ".callback-box/chat-turn-marker";

export interface TurnMarker {
  /** Full git HEAD sha the box was left at when the turn completed. */
  head: string;
  /** ISO timestamp the marker was recorded. */
  time: string;
}

/** Filename-safe per-session marker path. Session ids are uuids in practice;
 *  the replace is belt-and-suspenders against a stray path separator. */
function markerPath(boxRoot: string, sessionId: string): string {
  const safe = sessionId.replace(/[^\w-]/g, "_");
  return path.join(boxRoot, MARKER_DIR, `${safe}.json`);
}

/**
 * Record a session's turn-completion marker. Synchronous so the caller can
 * write it before draining the message queue without an intervening await.
 * Throws on I/O failure — the caller guards with try/catch and proceeds.
 */
export function recordTurnMarker(
  boxRoot: string,
  { sessionId, head, time }: { sessionId: string; head: string; time: string },
): void {
  const file = markerPath(boxRoot, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ head, time }));
}

/**
 * Resolve the current HEAD and record it as `sessionId`'s marker. Awaited by
 * the session before its queue drains so the next turn can't race ahead. A
 * no-op when there are no commits to anchor to; failures are logged and
 * swallowed (the command's marker-absent fallback covers a missing marker).
 */
export async function recordTurnMarkerForSession(boxRoot: string, sessionId: string): Promise<void> {
  try {
    const head = await getHeadSha(boxRoot);
    if (head === null) return;
    recordTurnMarker(boxRoot, { sessionId, head, time: new Date().toISOString() });
  } catch (e) {
    console.warn(`[chat-turn-marker] Failed to record marker: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Load a session's turn marker, or null if absent / unreadable / malformed. */
export function loadTurnMarker(boxRoot: string, sessionId: string): TurnMarker | null {
  try {
    const file = markerPath(boxRoot, sessionId);
    if (!fs.existsSync(file)) return null;
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!isRecord(data) || typeof data.head !== "string" || typeof data.time !== "string") return null;
    return { head: data.head, time: data.time };
  } catch (_e) {
    return null;
  }
}
