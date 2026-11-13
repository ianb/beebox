/**
 * After a transcribed call ends (docs/plans/chat-calls.md, Track G): wait for
 * every registered recording's HQ job, read what happened in the chat during
 * the call from its own transcript, fold, and deliver one `<call>` message.
 * The fold record (`record.ts`) is the only state; it is removed once the
 * message is in the chat's transcript, so a restart before then folds and
 * delivers the call again.
 */

import { startAwakeTimeout } from "../../../../shared/awake-timeout.js";
import { serializeDeliveredUserMessage } from "../../../../shared/delivered-user-message.js";
import { MAX_SESSION_ENTRIES, stripSpeechWrappers, type SessionEntry } from "../../../../cli/lib/session.js";
import { readStagingSession } from "../../../capture/staging-store/core.js";
import type { EventBus } from "../../../event-bus/core.js";
import { loadSessionHistory } from "../../session/load-history.js";
import { userMessageAlreadyLanded } from "../../session/deliver-user-message.js";
import { foldCall, type FoldActivity, type FoldRecording } from "./fold.js";
import { listFoldRecords, readFoldRecord, removeFoldRecord, type FoldRecord } from "../record.js";

/** How long after the call ends the fold waits for recordings before calling them partial. */
const WAIT_BUDGET_MS = 30 * 60_000;
/** A recording whose tab reopens later uploads without a bus event until its HQ job starts. */
const RECHECK_MS = 60_000;
/** Repeated changes to one card closer together than this are one line. */
const CARD_CHANGE_MERGE_MS = 60_000;

/** Real wall-clock time, never the box's shifted clock: recordings are stamped by device clocks. */
export interface CallFoldClock {
  now: () => number;
  /** Resolve after `ms` of awake time, or sooner when `wake` resolves. */
  sleep: (ms: number, wake: Promise<void>) => Promise<void>;
}

export interface CallFoldDeps {
  boxRoot: string;
  eventBus: EventBus;
  /** Put the `<call>` message into the chat. */
  deliver: (opts: { sessionId: string; message: string }) => Promise<void>;
  clock?: CallFoldClock;
}

const realClock: CallFoldClock = {
  now: () => Date.now(),
  sleep: (ms, wake) =>
    new Promise<void>((resolve) => {
      const timer = startAwakeTimeout({ timeoutMs: ms, onTimeout: () => resolve(), unref: true });
      void wake.then(() => {
        timer.stop();
        resolve();
      });
    }),
};

/**
 * A recording's result, null when it can no longer produce one, or "pending".
 * Registration names only a voice session id, so the recording must also say
 * it belongs to this call and was made by the person it is registered for;
 * otherwise someone else's words could be folded under the registrant's name.
 */
async function recordingOutcome(boxRoot: string, opts: { id: string; callId: string; email: string }): Promise<FoldRecording["result"] | "pending"> {
  const session = await readStagingSession({ boxRoot, id: opts.id });
  const voice = session?.voice;
  // Not created yet: the member's staging queue may still upload it.
  if (session === null || voice === undefined) return "pending";
  if (session.createdBy?.toLowerCase() !== opts.email.toLowerCase() || (voice.call !== undefined && voice.call.callId !== opts.callId)) {
    console.warn(`[call-transcript] Recording ${opts.id} is not ${opts.email}'s recording of call ${opts.callId}; left out`);
    return null;
  }
  if (voice.hq.state === "ready") {
    if (voice.call === undefined) return null;
    return { firstAudioAtMs: voice.call.firstAudioAtMs, text: voice.hq.result.text, words: voice.hq.result.words ?? null };
  }
  if (voice.hq.state === "failed" || (voice.sealedAt !== undefined && voice.hq.state === "none")) return null;
  return "pending";
}

async function settleRecordings(deps: CallFoldDeps & { clock: CallFoldClock }, opts: { record: FoldRecord; deadlineMs: number }): Promise<FoldRecording[]> {
  const { record, deadlineMs } = opts;
  const ids = new Set(record.recordings.map((r) => r.voiceSessionId));
  let wake: () => void = () => {};
  const sub = deps.eventBus.subscribe({
    listener: (event) => {
      if (event.event === "voice-recording-status" && ids.has(event.data.recordingId)) wake();
    },
  });
  try {
    for (;;) {
      const outcomes = await Promise.all(record.recordings.map((r) => recordingOutcome(deps.boxRoot, { id: r.voiceSessionId, callId: record.callId, email: r.person.email })));
      const remainingMs = deadlineMs - deps.clock.now();
      if (outcomes.every((o) => o !== "pending") || remainingMs <= 0) {
        return record.recordings.map((r, i) => {
          const outcome = outcomes[i];
          return { person: r.person, clockOffsetMs: r.clockOffsetMs, result: outcome === undefined || outcome === "pending" ? null : outcome };
        });
      }
      await deps.clock.sleep(Math.min(RECHECK_MS, remainingMs), new Promise<void>((resolve) => (wake = resolve)));
    }
  } finally {
    sub.unsubscribe();
  }
}

function plainText(entry: SessionEntry): string {
  return entry.content
    .flatMap((b) => (b.type === "text" && b.text !== undefined ? [entry.type === "user" ? stripSpeechWrappers(b.text) : b.text.replace(/<[^>]*>/g, "")] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The agent's replies, and one line per agent turn naming its tools. */
function chatLines(entries: readonly SessionEntry[]): FoldActivity[] {
  const lines: FoldActivity[] = [];
  let turn: { atMs: number; tools: string[] } | null = null;
  const endTurn = (): void => {
    if (turn !== null && turn.tools.length > 0) lines.push({ atMs: turn.atMs, text: `Box worked: ${turn.tools.join("; ")}` });
    turn = null;
  };
  for (const entry of entries) {
    const atMs = Date.parse(entry.timestamp);
    const text = plainText(entry);
    if (entry.type === "user") {
      // Typed messages come from the fold record, kept as they were sent (`record.ts`).
      endTurn();
    } else if (entry.type === "assistant") {
      turn ??= { atMs, tools: [] };
      for (const b of entry.content) {
        if (b.type === "tool_use" && b.toolName !== undefined) turn.tools.push([b.toolName, b.inputSummary ?? ""].join(" ").trim());
      }
      if (text !== "") lines.push({ atMs, text: `Box: ${text}` });
    }
  }
  endTurn();
  return lines;
}

function cardLines(changes: FoldRecord["cardChanges"]): FoldActivity[] {
  const lastSeen = new Map<string, number>();
  const lines: FoldActivity[] = [];
  for (const change of changes.toSorted((a, b) => a.atMs - b.atMs)) {
    const last = lastSeen.get(change.path);
    lastSeen.set(change.path, change.atMs);
    if (last === undefined || change.atMs - last > CARD_CHANGE_MERGE_MS) lines.push({ atMs: change.atMs, text: `Card changed: ${change.path}` });
  }
  return lines;
}

/** Chat entries timestamped inside the call. Transcript times are the agent runtime's real clock. */
async function activityDuring(boxRoot: string, record: FoldRecord & { endedAt: number }): Promise<FoldActivity[]> {
  const { entries } = await loadSessionHistory(boxRoot, { sessionId: record.sessionId, slice: { mode: "tail", tail: MAX_SESSION_ENTRIES }, fresh: true });
  const during = entries.filter((e) => {
    const atMs = Date.parse(e.timestamp);
    return atMs >= record.startedAt && atMs <= record.endedAt;
  });
  const typed = record.chatMessages.map((m) => ({ atMs: m.atMs, text: `${m.name} (in chat): ${m.text}` }));
  return [...typed, ...chatLines(during), ...cardLines(record.cardChanges)];
}

const inFlight = new Set<string>();

/** Fold and deliver one ended call. A second run for the same call while one is going is skipped. */
export async function foldAndDeliver(deps: CallFoldDeps, callId: string): Promise<void> {
  const key = `${deps.boxRoot}\0${callId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const record = await readFoldRecord(deps.boxRoot, callId);
    if (record === null) return;
    const ended = { ...record, endedAt: record.endedAt ?? record.updatedAt };
    const clock = deps.clock ?? realClock;
    const recordings = await settleRecordings({ ...deps, clock }, { record, deadlineMs: ended.endedAt + WAIT_BUDGET_MS });
    const activity = await activityDuring(deps.boxRoot, ended);
    const folded = foldCall({ ...ended, recordings, activity });
    // The record goes only once the message is in the chat's transcript. A busy
    // agent queues it in memory, so a restart before its turn would lose it;
    // the next start finds it missing and delivers again. Already there: not twice.
    const landed = (): Promise<boolean> => userMessageAlreadyLanded({ boxRoot: deps.boxRoot, sessionId: record.sessionId, marker: folded.started, logPrefix: "call-transcript" });
    if (!(await landed())) await deps.deliver({ sessionId: record.sessionId, message: serializeDeliveredUserMessage(folded) });
    if (await landed()) await removeFoldRecord(deps.boxRoot, callId);
  } finally {
    inFlight.delete(key);
  }
}

/** At startup: fold every recorded call that is not going on in this process. Returns the call ids. */
export async function resumeCallFolds(deps: CallFoldDeps, opts: { isLive: (callId: string) => boolean }): Promise<string[]> {
  const ids = (await listFoldRecords(deps.boxRoot)).map((r) => r.callId).filter((id) => !opts.isLive(id));
  const results = await Promise.allSettled(ids.map((id) => foldAndDeliver(deps, id)));
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") console.error(`[call-transcript] Folding call ${ids[i] ?? "?"} failed; its record stays for the next start:`, result.reason);
  }
  return ids;
}
