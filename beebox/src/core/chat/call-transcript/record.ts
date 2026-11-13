/**
 * The fold record: `_tmp/calls/<callId>.json`, everything the box needs to fold
 * a transcribed call after it ends (docs/plans/chat-calls.md, Track G). The
 * call itself lives only in memory; this file is written when transcription
 * first turns on, updated on each member, transcription and recording change
 * and each card change, and removed once the `<call>` message is delivered.
 * A server restart therefore loses no call that was transcribed.
 *
 * Times are real wall-clock ms (`Date.now()`), never the box's shifted clock:
 * they are compared with each device's own clock.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { boxTmpDir } from "../../../lib/box-tmp.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { errnoCode } from "../../../shared/error-guards.js";
import type { CallChange, CallSnapshot, PresentPerson } from "../presence/room.js";

const PersonSchema = z.object({ email: z.string(), name: z.string() });

const FoldRecordSchema = z.object({
  callId: z.string(),
  sessionId: z.string(),
  startedAt: z.number(),
  /** Null while the call is going on. */
  endedAt: z.number().nullable(),
  /** The last write; stands in for the end of a call the server lost track of. */
  updatedAt: z.number(),
  /** Everyone who was on the call, in join order. */
  people: z.array(PersonSchema),
  transcribingChanges: z.array(z.object({ by: PersonSchema, atMs: z.number(), on: z.boolean() })),
  /** Voice staging sessions registered before their capture started. */
  recordings: z.array(z.object({ voiceSessionId: z.string(), person: PersonSchema, clockOffsetMs: z.number() })),
  /** Box-relative card paths changed during the call. */
  cardChanges: z.array(z.object({ path: z.string(), atMs: z.number() })),
  /**
   * Messages people typed into the chat during the call, kept as they were
   * sent: one sent while the agent is busy reaches the chat's transcript only
   * when its turn starts, which can be after the fold.
   */
  chatMessages: z.array(z.object({ name: z.string(), text: z.string(), atMs: z.number() })),
});
export type FoldRecord = z.infer<typeof FoldRecordSchema>;

function callsDir(boxRoot: string): string {
  return path.join(boxTmpDir(boxRoot), "calls");
}

function recordPath(boxRoot: string, callId: string): string {
  return path.join(callsDir(boxRoot), `${callId}.json`);
}

async function readAt(file: string): Promise<FoldRecord | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  let parsed;
  try {
    parsed = FoldRecordSchema.safeParse(JSON.parse(raw));
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    parsed = null;
  }
  if (parsed?.success !== true) {
    // Left on disk for a person to inspect; the `_tmp` sweep removes it after a week.
    console.error(`[call-transcript] Ignoring malformed fold record ${file}`);
    return null;
  }
  return parsed.data;
}

export async function readFoldRecord(boxRoot: string, callId: string): Promise<FoldRecord | null> {
  return readAt(recordPath(boxRoot, callId));
}

/** Every fold record in the box. */
export async function listFoldRecords(boxRoot: string): Promise<FoldRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(callsDir(boxRoot));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const records = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => readAt(path.join(callsDir(boxRoot), n))));
  return records.filter((r) => r !== null);
}

export async function removeFoldRecord(boxRoot: string, callId: string): Promise<void> {
  await fs.rm(recordPath(boxRoot, callId), { force: true });
}

/** Read, change and write one record under its lock. `change` returns null to leave the file as it is. */
async function updateRecord(
  boxRoot: string,
  opts: { callId: string; nowMs: number; change: (current: FoldRecord | null) => FoldRecord | null },
): Promise<FoldRecord | null> {
  const file = recordPath(boxRoot, opts.callId);
  return withCardLock(file, async () => {
    const next = opts.change(await readAt(file));
    if (next === null) return null;
    const written = { ...next, updatedAt: opts.nowMs };
    await writeFileAtomic(file, { content: `${JSON.stringify(written, null, 2)}\n` });
    return written;
  });
}

function withPeople(record: FoldRecord, people: PresentPerson[]): FoldRecord {
  const known = new Set(record.people.map((p) => p.email));
  return { ...record, people: [...record.people, ...people.filter((p) => !known.has(p.email))] };
}

function freshRecord(snapshot: CallSnapshot, nowMs: number): FoldRecord {
  const base: FoldRecord = {
    callId: snapshot.callId,
    sessionId: snapshot.sessionId,
    startedAt: snapshot.startedAt,
    endedAt: null,
    updatedAt: nowMs,
    people: [snapshot.startedBy],
    transcribingChanges: [],
    recordings: [],
    cardChanges: [],
    chatMessages: [],
  };
  return withPeople(base, snapshot.members.map((m) => m.person));
}

/**
 * Apply one call change. The record is made by the first change that turns
 * transcription on; a call that is never transcribed writes nothing.
 */
export async function recordCallChange(
  boxRoot: string,
  opts: { snapshot: CallSnapshot; change: CallChange; nowMs: number },
): Promise<FoldRecord | null> {
  const { snapshot, change, nowMs } = opts;
  return updateRecord(boxRoot, {
    callId: snapshot.callId,
    nowMs,
    change: (current) => {
      if (current === null && !(change.kind === "transcribing" && snapshot.transcribing)) return null;
      const record = withPeople(current ?? freshRecord(snapshot, nowMs), snapshot.members.map((m) => m.person));
      switch (change.kind) {
        case "started":
        case "members":
          return record;
        case "transcribing":
          return { ...record, transcribingChanges: [...record.transcribingChanges, { by: change.by, atMs: change.atMs, on: snapshot.transcribing }] };
        case "ended":
          return { ...record, endedAt: nowMs };
      }
    },
  });
}

/** Register a member's recording before its capture starts, making the record if the transcribing change has not yet. */
export async function registerCallRecording(
  boxRoot: string,
  opts: { snapshot: CallSnapshot; recording: FoldRecord["recordings"][number]; nowMs: number },
): Promise<void> {
  const { snapshot, recording, nowMs } = opts;
  await updateRecord(boxRoot, {
    callId: snapshot.callId,
    nowMs,
    change: (current) => {
      const record = current ?? freshRecord(snapshot, nowMs);
      if (record.recordings.some((r) => r.voiceSessionId === recording.voiceSessionId)) return record;
      return { ...record, recordings: [...record.recordings, recording] };
    },
  });
}

/** Note a card change during a call that has a record. */
export async function recordCardChange(boxRoot: string, opts: { callId: string; path: string; atMs: number }): Promise<void> {
  await updateRecord(boxRoot, {
    callId: opts.callId,
    nowMs: opts.atMs,
    change: (current) => (current === null || current.endedAt !== null ? null : { ...current, cardChanges: [...current.cardChanges, { path: opts.path, atMs: opts.atMs }] }),
  });
}

/** Note a message typed into the chat during a call that has a record. */
export async function recordChatMessage(boxRoot: string, opts: { callId: string; message: FoldRecord["chatMessages"][number] }): Promise<void> {
  await updateRecord(boxRoot, {
    callId: opts.callId,
    nowMs: opts.message.atMs,
    change: (current) => (current === null || current.endedAt !== null ? null : { ...current, chatMessages: [...current.chatMessages, opts.message] }),
  });
}
