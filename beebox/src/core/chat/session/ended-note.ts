/**
 * The run-ended note: a chat's next turn learns why and when its background
 * tasks were cut off (docs/implemented-plans/chat-termination-notes.md).
 *
 * While a run has live background tasks, `.beebox/chat-run-ended/<session>.json`
 * holds them, when the run was last seen working, and which server process
 * wrote it. When the server ends such a run it stamps a cause. The next turn
 * reads a stamped record, or an unstamped one another server process wrote
 * (this process never saw that run end: the server crashed or was killed), into
 * its `<chat-app>` snapshot (hidden from the person's message), and removes it
 * once the turn is dispatched. Delivery is best effort: a crash between that
 * removal and the agent reading its input loses the note.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../../../lib/atomic-write.js";
import { escapeXmlAttr } from "../../../shared/self-note.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";

/** This server process. A record another process wrote is from a run this one never saw end. */
const WRITER = randomUUID();
const SERVER_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

const recordSchema = z.object({
  tasks: z.array(z.string()),
  lastSeenAt: z.string().optional(),
  writer: z.string().optional(),
  /** When the run ended, with `cause`; also the field the first notes (maintenance only) wrote. */
  at: z.string().optional(),
  cause: z.string().optional(),
  /** Whether the cause was an interruption from outside, so the server wakes the chat (`./interrupted-wake.ts`). */
  wake: z.boolean().optional(),
  /** When the server woke the chat for this note; it wakes once per note. */
  wokenAt: z.string().optional(),
  /** First notes only: the maintenance owner's reason. */
  reason: z.string().optional(),
});
export type TaskRecord = z.infer<typeof recordSchema>;

/** Why the server ended a run: the agent-facing text, and whether it was an interruption the chat should wake for. */
export interface EndCause { readonly text: string; readonly wake: boolean }

export const END_CAUSES = {
  shutdown: { text: "the Bee Box server shut down", wake: true },
  processEnded: { text: "the agent process ended on its own", wake: true },
  hung: { text: "it had produced no output for 4 hours and was treated as hung", wake: false },
  restartRequested: { text: "a restart was requested", wake: false },
  modelChange: { text: "a model change was requested", wake: false },
  providerChanged: { text: "its provider setup changed", wake: false },
} as const satisfies Record<string, EndCause>;

export function maintenanceCause(reason: string): EndCause { return { text: `box maintenance (${reason})`, wake: true }; }

export const RECORD_DIR = path.join(".beebox", "chat-run-ended");

export function recordPath(boxRoot: string, sessionId: string): string {
  return path.join(boxRoot, RECORD_DIR, `${encodeURIComponent(sessionId)}.json`);
}

function write(file: string, { sessionId, record }: { sessionId: string; record: TaskRecord }): void {
  try { writeFileAtomicSync(file, { content: JSON.stringify(record) }); }
  catch (error) { console.error(`[ChatSession] Background-task record for ${sessionId} was not written: ${errorMessage(error)}`); }
}

function remove(file: string, sessionId: string): void {
  try { fs.rmSync(file, { force: true }); }
  catch (error) { console.error(`[ChatSession] Background-task record for ${sessionId} was not removed: ${errorMessage(error)}`); }
}

/** The record one session's live tasks keep current, from the SDK's task updates and run messages. */
export interface TaskRecorder {
  /** Tasks now live (empty: they settled, and an unstamped record goes). */
  observe(tasks: string[], now: Date): void;
  /** The run produced a message; refresh `lastSeenAt` at most once a minute. */
  heartbeat(tasks: string[], now: Date): void;
  /** The server ended the run while `tasks` were live, for `cause`. */
  ended(end: { tasks: string[]; cause: EndCause; now: Date }): void;
}

const HEARTBEAT_MS = 60_000;

export function createTaskRecorder(boxRoot: string, sessionId: () => string | null): TaskRecorder {
  let lastWrite = 0;
  const put = (record: Omit<TaskRecord, "writer">, now: Date): void => {
    const id = sessionId();
    if (id === null) return;
    lastWrite = now.getTime();
    write(recordPath(boxRoot, id), { sessionId: id, record: { ...record, writer: WRITER } });
  };
  return {
    observe(tasks, now) {
      const id = sessionId();
      if (id === null) return;
      if (tasks.length > 0) { put({ tasks, lastSeenAt: now.toISOString() }, now); return; }
      const file = recordPath(boxRoot, id);
      const current = readRecord(file, id);
      // A stamped record is the previous run's note, still waiting for its turn.
      if (current !== null && current.cause === undefined && current.reason === undefined) remove(file, id);
    },
    heartbeat(tasks, now) {
      if (tasks.length > 0 && now.getTime() - lastWrite >= HEARTBEAT_MS) put({ tasks, lastSeenAt: now.toISOString() }, now);
    },
    ended({ tasks, cause, now }) {
      put({ tasks, lastSeenAt: now.toISOString(), at: now.toISOString(), cause: cause.text, wake: cause.wake }, now);
    },
  };
}

export function readRecord(file: string, sessionId: string): TaskRecord | null {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    // An unreadable record must not block the chat's turn; say so and drop it.
    console.error(`[ChatSession] Background-task record for ${sessionId} is unreadable: ${errorMessage(error)}`);
    remove(file, sessionId);
    return null;
  }
  const parsed = recordSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.error(`[ChatSession] Background-task record for ${sessionId} is malformed; dropped`);
  remove(file, sessionId);
  return null;
}

/** Whether this process wrote the record (an unstamped one is then live, or about to be stamped). */
export function writtenHere(record: TaskRecord): boolean { return record.writer === WRITER; }

export function render(record: TaskRecord): string | undefined {
  const count = record.tasks.length === 1 ? "1 background task was" : `${String(record.tasks.length)} background tasks were`;
  const listed = record.tasks.map((task) => `- ${escapeXmlAttr(task)}`).join("\n");
  const cause = record.cause ?? (record.reason === undefined ? undefined : `box maintenance (${record.reason})`);
  if (cause !== undefined) {
    const at = record.at ?? record.lastSeenAt ?? "an unknown time";
    return `<run-ended at="${escapeXmlAttr(at)}" cause="${escapeXmlAttr(cause)}">\nYour previous run ended at ${escapeXmlAttr(at)} while ${count} still running, because ${escapeXmlAttr(cause)}. They did not finish; restart any that are still needed.\n${listed}\n</run-ended>`;
  }
  // Unstamped and written by this process: the run is live, or its close has not been stamped yet.
  if (record.writer === WRITER) return undefined;
  const seen = record.lastSeenAt ?? "an unknown time";
  return `<run-ended last-seen="${escapeXmlAttr(seen)}" cause="unknown">\nYour previous run ended while ${count} running; it was last seen working at ${escapeXmlAttr(seen)}. No cause was recorded, and the Bee Box server restarted since (at ${SERVER_STARTED_AT}), so the server most likely crashed or was killed, for example for running out of memory. They did not finish; restart any that are still needed.\n${listed}\n</run-ended>`;
}

export interface PendingRunEndedNote {
  /** The `<run-ended>` element for the snapshot, or undefined when there is none. */
  readonly element: string | undefined;
  /** Remove the note once the turn carrying it is dispatched; a record rewritten since the read stays. */
  clear(): void;
}

/** Read without removing: a turn that fails before dispatch leaves the note for the next one. */
export function pendingRunEndedNote(boxRoot: string, sessionId: string | null): PendingRunEndedNote {
  const none = { element: undefined, clear: () => {} };
  if (sessionId === null) return none;
  const file = recordPath(boxRoot, sessionId);
  const record = readRecord(file, sessionId);
  const element = record === null ? undefined : render(record);
  if (record === null || element === undefined) return none;
  // The wake's claim (`wokenAt`) lands just before dispatch; it is the same note.
  const sameNote = (other: TaskRecord): string => JSON.stringify({ ...other, wokenAt: undefined });
  const read = sameNote(record);
  return {
    element,
    clear: () => {
      const now = readRecord(file, sessionId);
      if (now !== null && sameNote(now) === read) remove(file, sessionId);
    },
  };
}
