/**
 * waitForTranscriptEntry — block (bounded) until the session transcript on
 * disk contains a given entry uuid.
 *
 * The Claude CLI emits a turn's `result` message over stdout *before* it
 * flushes the turn's final assistant entry to the transcript .jsonl (~150ms
 * lag, measured). Anything that refetches history the moment a turn ends —
 * the chat UI's STREAM_RESULT refresh, other tabs reacting to
 * `chat-complete` — reads a transcript that's missing the final message, and
 * the reply silently vanishes until some later refetch. ChatSession calls
 * this before surfacing `result`/`done`, so "turn ended" means "turn is
 * durable": every consumer's immediate history read includes the full turn.
 *
 * Matching is exact: the SDK emits one assistant message per content block,
 * and each one's `uuid` is the transcript line's `uuid` (verified against
 * live transcripts). Entries are appended in order, so finding the *last*
 * assistant uuid implies everything before it is flushed too.
 */

import { open, type FileHandle } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveSessionLogPath } from "./chat-session-history.js";
import type { ChatMessage } from "./chat-session-messages.js";

/** How long past `result` we'll wait for the flush before giving up. The
 *  measured lag is ~150ms; the cap only bites if the CLI misbehaves. */
const WAIT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 30;
/** Tail window searched per poll. The trailing entries of a turn (final
 *  assistant text/thinking lines) are far smaller than this. */
const TAIL_BYTES = 512 * 1024;

/**
 * Read the last `TAIL_BYTES` of the file as UTF-8, or null when the file
 * doesn't exist yet (a first turn's transcript appears mid-flush).
 */
async function readTail(logPath: string): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(logPath, "r");
  } catch (_e) {
    return null; // not flushed into existence yet — poll again
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf-8");
  } finally {
    await handle.close();
  }
}

/**
 * Resolve when the session's transcript contains an entry with `uuid`, or
 * when the bounded wait elapses. Returns whether the entry was found —
 * callers proceed either way (the transcript is an eventual-consistency
 * floor, not a gate we'd wedge a turn on), but a `false` is worth a warning.
 * `timeoutMs` exists for tests; production callers take the default.
 */
export async function waitForTranscriptEntry(
  { boxRoot, sessionId, uuid, timeoutMs }: {
    boxRoot: string;
    sessionId: string;
    uuid: string;
    timeoutMs?: number;
  },
): Promise<boolean> {
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  const needle = `"uuid":"${uuid}"`;
  const deadline = Date.now() + (timeoutMs ?? WAIT_TIMEOUT_MS);
  for (;;) {
    const tail = await readTail(logPath);
    if (tail !== null && tail.includes(needle)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Per-session tracker that pairs message observation with the wait:
 * `observe` records the uuid of the most recent assistant message, and
 * `awaitDurability` (called when `result` arrives, before it's surfaced)
 * blocks until that entry is on disk. ChatSession owns one and calls both
 * from its message-pump loop; the context thunk defers reading the session
 * id until it's actually been assigned.
 */
export interface TurnDurabilityGate {
  observe(msg: ChatMessage): void;
  awaitDurability(): Promise<void>;
}

export function createTurnDurabilityGate(
  getContext: () => { boxRoot: string; sessionId: string | null },
): TurnDurabilityGate {
  let lastAssistantUuid: string | null = null;
  return {
    observe(msg: ChatMessage): void {
      if (msg.type === "assistant" && msg.uuid !== undefined) {
        lastAssistantUuid = msg.uuid;
      }
    },
    async awaitDurability(): Promise<void> {
      const uuid = lastAssistantUuid;
      lastAssistantUuid = null;
      const { boxRoot, sessionId } = getContext();
      // No assistant output (errored turn) or no transcript identity yet
      // (fake-backend tests) — nothing to wait on.
      if (uuid === null || sessionId === null) return;
      const found = await waitForTranscriptEntry({ boxRoot, sessionId, uuid });
      if (!found) {
        console.warn(
          `[chat-session] transcript flush wait timed out for entry ${uuid} (session ${sessionId}); an immediate history fetch may miss the turn's final message`,
        );
      }
    },
  };
}
