/**
 * Timestamp, time-range, and session-divider formatting for `bbx session`.
 *
 * These produce the headers and list rows that frame rendered transcripts:
 * `═══ Session … ═══` dividers and the `--list` summary lines.
 */

import {
  getSessionMetadata,
  type SessionMetadata,
} from "../lib/session.js";
import { fmt } from "../../lib/format.js";

/** Session metadata plus the context root the transcript was found under. */
export interface EnrichedSession extends SessionMetadata {
  /** Box-relative context dir ("" = box root). */
  contextDir: string;
}

function formatTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").substring(0, 16);
}

function formatTimeRange(start: Date | null, end: Date | null): string {
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

/** Dim `[<contextDir>]` tag for landmark-bound sessions; "" for root-bound. */
function contextLabel(contextDir: string): string {
  if (contextDir === "") return "";
  return `  ${fmt.dim(`[${contextDir}]`)}`;
}

export function sessionDivider(meta: EnrichedSession): string {
  const range = formatTimeRange(meta.startTime, meta.endTime);
  return `═══ Session ${meta.sessionId}  ${range} ═══${contextLabel(meta.contextDir)}`;
}

/**
 * Divider for --since mode: shows the range of in-window activity, and notes
 * when the session itself started before the window (so a reader knows this
 * is a continuation rather than a fresh session).
 */
export function sessionDividerForWindow(
  meta: EnrichedSession,
  shown: { start: Date; end: Date }
): string {
  const range = formatTimeRange(shown.start, shown.end);
  const started = meta.startTime;
  const suffix =
    started !== null && started.getTime() < shown.start.getTime()
      ? ` (continues from ${formatTimestamp(started)})`
      : "";
  return `═══ Session ${meta.sessionId}  ${range}${suffix} ═══${contextLabel(meta.contextDir)}`;
}

export function printListRow(meta: EnrichedSession): void {
  const id = `${meta.sessionId.substring(0, 12)}...`;
  const range = formatTimeRange(meta.startTime, meta.endTime);
  const stats = `(${meta.userTurns}/${meta.assistantTurns} turns · ${meta.toolCount} tools)`;
  console.log(`  ${id}  ${range}  ${stats}${contextLabel(meta.contextDir)}`);
  if (meta.firstUserSnippet) {
    console.log(`    "${meta.firstUserSnippet}"`);
  }
}

export async function enrichSessions(
  sessions: Array<{ sessionId: string; path: string; contextDir: string }>
): Promise<EnrichedSession[]> {
  return Promise.all(
    sessions.map(async (s) => {
      const meta = await getSessionMetadata({ sessionId: s.sessionId, logPath: s.path });
      return { ...meta, contextDir: s.contextDir };
    })
  );
}
