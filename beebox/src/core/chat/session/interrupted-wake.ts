/**
 * Which interrupted chats the server wakes, and the claim that keeps each wake
 * to once per note and twice per chat a day (docs/plans/interrupted-chat-wake.md).
 *
 * A chat is interrupted when its run with live background tasks ended from
 * outside: box maintenance, a server shutdown or crash, or the agent process
 * dying. A hung run or an ending someone asked for is not; the note waits for
 * the next turn as before.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../../../lib/atomic-write.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { END_CAUSES, RECORD_DIR, readRecord, recordPath, render, writtenHere, type TaskRecord } from "./ended-note.js";

const WAKES_PER_DAY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const WAKE_LOG = path.join(".beebox", "chat-wakes.json");
const wakeLogSchema = z.record(z.string(), z.array(z.string()));

/** Records stamped before `wake` was recorded: the interruption causes by their text. */
const LEGACY_WAKE_TEXTS: ReadonlySet<string> = new Set([END_CAUSES.shutdown.text, END_CAUSES.processEnded.text]);

function isInterruption(record: TaskRecord): boolean {
  if (record.wake !== undefined) return record.wake;
  if (record.reason !== undefined) return true; // the first notes were maintenance only
  if (record.cause !== undefined) return record.cause.startsWith("box maintenance (") || LEGACY_WAKE_TEXTS.has(record.cause);
  return !writtenHere(record); // unstamped: another server process wrote it and never saw the end
}

export interface WakeCandidate {
  readonly sessionId: string;
  /** No cause was stamped: the caller must first check the run is not still live. */
  readonly unstamped: boolean;
  /** The record as selected; the claim refuses a record replaced since (`claimWake`). */
  readonly selected: string;
}

/** Sessions whose run-ended note is for an interruption and has not woken the chat yet. */
export function wakeCandidates(boxRoot: string): WakeCandidate[] {
  let names: string[];
  try { names = fs.readdirSync(path.join(boxRoot, RECORD_DIR)); }
  catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  const candidates: WakeCandidate[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const sessionId = decodeURIComponent(name.slice(0, -".json".length));
    const record = readRecord(recordPath(boxRoot, sessionId), sessionId);
    if (record === null || record.wokenAt !== undefined || render(record) === undefined || !isInterruption(record)) continue;
    candidates.push({ sessionId, unstamped: record.cause === undefined && record.reason === undefined, selected: JSON.stringify(record) });
  }
  return candidates;
}

function readWakeLog(boxRoot: string, now: Date): Record<string, string[]> {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(boxRoot, WAKE_LOG), "utf8")); }
  catch (error) {
    if (errnoCode(error) === "ENOENT") return {};
    throw error;
  }
  const since = now.getTime() - DAY_MS;
  const recent: Record<string, string[]> = {};
  for (const [id, times] of Object.entries(wakeLogSchema.parse(raw))) {
    const kept = times.filter((time) => Date.parse(time) > since);
    if (kept.length > 0) recent[id] = kept;
  }
  return recent;
}

/** Whether the chat has a wake left today. */
export function wakeAllowed(boxRoot: string, { sessionId, now }: { sessionId: string; now: Date }): boolean {
  return (readWakeLog(boxRoot, now)[sessionId]?.length ?? 0) < WAKES_PER_DAY;
}

/**
 * Mark the selected note woken, unless it was replaced since. With `count`, the wake is also logged against the daily
 * limit, refused when the limit is spent. True only when everything was
 * written: a wake that cannot be recorded must not be sent, or a crash loop
 * could repeat it.
 */
export function claimWake(boxRoot: string, { candidate, now, count }: { candidate: WakeCandidate; now: Date; count: boolean }): boolean {
  const { sessionId } = candidate;
  const file = recordPath(boxRoot, sessionId);
  const record = readRecord(file, sessionId);
  // Replaced since selection (the person's turn took the note and new work began): not this wake's note.
  if (record === null || JSON.stringify(record) !== candidate.selected) return false;
  try {
    if (count) {
      const log = readWakeLog(boxRoot, now);
      const times = log[sessionId] ?? [];
      if (times.length >= WAKES_PER_DAY) return false;
      writeFileAtomicSync(path.join(boxRoot, WAKE_LOG), { content: JSON.stringify({ ...log, [sessionId]: [...times, now.toISOString()] }) });
    }
    writeFileAtomicSync(file, { content: JSON.stringify({ ...record, wokenAt: now.toISOString() }) });
    return true;
  } catch (error) {
    console.error(`[interrupted-wake] Wake for ${sessionId} was not recorded: ${errorMessage(error)}`);
    return false;
  }
}
