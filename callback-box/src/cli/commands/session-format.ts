/**
 * Timestamp, time-range, and session-divider formatting for `cb session`.
 *
 * These produce the headers and list rows that frame rendered transcripts:
 * `═══ Session … ═══` dividers and the `--list` summary lines.
 */

import {
  getSessionMetadata,
  type SessionMetadata,
} from "../lib/session.js";

function formatTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").substring(0, 16);
}

export function formatTimeRange(start: Date | null, end: Date | null): string {
  if (!start) return "(empty)";
  const startStr = formatTimestamp(start);
  if (!end) return startStr;
  const endStr = formatTimestamp(end);
  if (endStr === startStr) return startStr;
  const startDate = startStr.substring(0, 10);
  const endDate = endStr.substring(0, 10);
  if (startDate === endDate) {
    return `${startStr} → ${endStr.substring(11)}`;
  }
  return `${startStr} → ${endStr}`;
}

export function sessionDivider(meta: SessionMetadata): string {
  const range = formatTimeRange(meta.startTime, meta.endTime);
  return `═══ Session ${meta.sessionId}  ${range} ═══`;
}

/**
 * Divider for --since mode: shows the range of in-window activity, and notes
 * when the session itself started before the window (so a reader knows this
 * is a continuation rather than a fresh session).
 */
export function sessionDividerForWindow(
  meta: SessionMetadata,
  shown: { start: Date; end: Date }
): string {
  const range = formatTimeRange(shown.start, shown.end);
  const started = meta.startTime;
  const isContinuation = started !== null && started.getTime() < shown.start.getTime();
  const suffix = isContinuation
    ? ` (continues from ${formatTimestamp(started!)})`
    : "";
  return `═══ Session ${meta.sessionId}  ${range}${suffix} ═══`;
}

export function printListRow(meta: SessionMetadata): void {
  const id = `${meta.sessionId.substring(0, 12)}...`;
  const range = formatTimeRange(meta.startTime, meta.endTime);
  const stats = `(${meta.userTurns}/${meta.assistantTurns} turns · ${meta.toolCount} tools)`;
  console.log(`  ${id}  ${range}  ${stats}`);
  if (meta.firstUserSnippet) {
    console.log(`    "${meta.firstUserSnippet}"`);
  }
}

export async function enrichSessions(
  sessions: Array<{ sessionId: string; path: string }>
): Promise<SessionMetadata[]> {
  return Promise.all(
    sessions.map((s) =>
      getSessionMetadata({ sessionId: s.sessionId, logPath: s.path })
    )
  );
}
