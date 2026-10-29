/**
 * `loadSessionHistory` — THE way to read a chat session's conversation log.
 *
 * One loader for every caller (the ChatSession method, the `chat.history` /
 * `chat.bootstrap` procedures, the schedule-fire broadcast). It takes a
 * bounded {@link SessionLogSlice} and pushes it straight into
 * `parseSessionLog`, so no caller can reach an unbounded read by
 * construction — that path is what OOM'd `bbx serve` in prod (2026-08-01).
 *
 * Three near-identical variants used to exist (here, `session/state.ts`, and
 * `webapp/trpc/routers/chat-session-procedures.ts`), each parsing the whole
 * file and trimming the fully-materialized array afterwards. They are gone.
 *
 * Being the one door also makes single-flight coalescing possible here: see
 * {@link loadSessionHistory}.
 */

import type { SessionEntry, SessionLogSlice } from "../../../cli/lib/session.js";
import { resolveRecordedChatEngine } from "./engine.js";
import { SESSION_STORES } from "./native-store.js";
import type { AgentEngine } from "../../../shared/agent-models.js";

// Re-exported so callers of the loader name their slice from the same module.
export type { SessionLogSlice } from "../../../cli/lib/session.js";

/** How much history the chat UI loads on mount and on every refresh. */
const CHAT_HISTORY_TAIL = 200;
/** Floor on how many real (typed/spoken) user messages that window covers. */
const CHAT_HISTORY_MIN_REAL_USER_MESSAGES = 2;

/** The default chat window: the last {@link CHAT_HISTORY_TAIL} entries. */
export function chatHistorySlice(): SessionLogSlice {
  return {
    mode: "tail",
    tail: CHAT_HISTORY_TAIL,
    minRealUserMessages: CHAT_HISTORY_MIN_REAL_USER_MESSAGES,
  };
}

export interface SessionHistoryResult {
  sessionId: string | null;
  entries: SessionEntry[];
  /** Exact count of entries in the whole transcript, not just the window. */
  total: number;
}

/**
 * Reads currently in flight, keyed by the store, session and slice they read.
 *
 * The key includes the slice: a page-mode request and the chat page's tail
 * request read the same transcript into *different* answers, so sharing across
 * slices would hand a caller someone else's window.
 *
 * Entries are removed as soon as their read settles (success or failure), so
 * this is a coalescing window and NOT a cache: a caller arriving after the
 * resolution starts a fresh read and therefore sees a file that has since
 * appeared, grown, or been written to.
 */
const inFlight = new Map<string, Promise<SessionHistoryResult>>();

/** Process-lifetime count of parses actually performed (see below). */
let underlyingReads = 0;

/**
 * How many underlying parses ran, and how many reads are in flight right now.
 *
 * Coalescing is invisible from the outside — the same answer, fewer parses —
 * so this is the seam the regression test observes it through. Diagnostic
 * only: nothing in the request path reads it.
 */
export function sessionHistoryReadStats(): { reads: number; inFlight: number } {
  return { reads: underlyingReads, inFlight: inFlight.size };
}

/**
 * Stable key for a slice. Written out by hand rather than `JSON.stringify`d so
 * it cannot depend on property order or on an optional field's presence.
 */
function sliceKey(slice: SessionLogSlice): string {
  return slice.mode === "tail"
    ? `tail:${String(slice.tail)}:${String(slice.minRealUserMessages ?? 0)}`
    : `page:${String(slice.offset)}:${String(slice.limit)}`;
}

/** The actual read. One of these runs per in-flight key. */
async function readHistory(args: {
  boxRoot: string;
  engine: AgentEngine;
  sessionId: string;
  slice: SessionLogSlice;
}): Promise<SessionHistoryResult> {
  const { boxRoot, engine, sessionId, slice } = args;
  underlyingReads += 1;
  // A store without the session (a missing transcript file, an expired or
  // deleted Codex thread) reads as empty — see the ENOENT note below.
  const history = await SESSION_STORES[engine].readHistory(boxRoot, { sessionId, slice });
  const entries: SessionEntry[] = history?.entries ?? [];
  // Shared between coalesced callers — frozen so a future caller that starts
  // mutating the window fails loudly here instead of corrupting a peer's
  // answer. Shallow on purpose: the array is the shared handle callers hold.
  Object.freeze(entries);
  return { sessionId, entries, total: history?.total ?? 0 };
}

/**
 * Load a bounded window of conversation history for `sessionId`.
 *
 * **Concurrent identical reads share one parse.** A phone reconnecting fires
 * `chat.history` + `chat.bootstrap` (+ retries, with no backoff) in a burst,
 * and each one used to re-parse the whole transcript: ~50 MB of transient heap
 * per request on prod's 15.5 MB session, stacking linearly to the 1.9 GB V8
 * cap and killing `bbx serve` four times (2026-08-03/04,
 * `issues/closed/bugs/2026-08-04-chat-history-parse-transient-oom.md`). Callers that
 * arrive while a read of the same `(session, slice)` is running now await that
 * read instead of starting their own.
 *
 * **The returned result is therefore shared, and must not be mutated.** The
 * entries array is frozen to keep that honest; the entries themselves are not
 * deep-frozen, so treat the whole window as read-only.
 *
 * **Only ENOENT reads as empty.** A session id that hasn't produced a JSONL yet
 * (a brand-new chat, an SDK turn that errored before writing) is a normal
 * state, and an empty transcript is the truthful answer for it. Every other
 * read failure THROWS, because "empty" is not a safe degradation here — it is
 * indistinguishable from a real answer, and the callers act on it:
 * `chat-schedule-fire` broadcasts this result to every open tab, so a transient
 * EIO used to visibly wipe a live conversation off the screen. Failing loud
 * instead leaves each caller with the right behaviour: the tRPC procedures
 * (`chat.history`, `chat.bootstrap`) surface an error and the tab keeps the
 * state it has, and the broadcast's `.catch` skips the emit entirely.
 *
 * **`fresh: true` bypasses coalescing entirely.** A caller reading BECAUSE it
 * knows the transcript just changed (the post-turn-completion history
 * broadcast in `chat-schedule-fire.ts`) must never join a scan that started
 * before that change — coalescing exists for callers that all want "the
 * current state", not for one that just observed the state change and needs
 * its own read of it. A `fresh` read skips the `inFlight` lookup entirely
 * (so it can't join a stale scan) and never registers itself in `inFlight`
 * either (so an ordinary caller arriving alongside it isn't forced to wait on
 * a read whose whole point was to not be shared) — it is a plain, uncoalesced
 * read that happens to go through the same parser and ENOENT handling as
 * every other caller.
 */
export async function loadSessionHistory(
  boxRoot: string,
  opts: { sessionId: string | null; slice: SessionLogSlice; fresh?: boolean },
): Promise<SessionHistoryResult> {
  const { sessionId, slice, fresh = false } = opts;
  if (!sessionId) {
    return { sessionId: null, entries: [], total: 0 };
  }

  // The RECORDED engine, never the box default — and an unrecorded id reads the
  // Claude transcript file rather than being guessed into one store or the other.
  //
  // Reading history is the case where guessing costs the most. The two branches
  // are not symmetric in what a wrong guess does: the transcript-file read
  // treats a missing file as an empty transcript, while a Codex read for a
  // thread that never existed is an RPC error. So a `codex` guess at an id with
  // no record turns a chat into an error banner, and a `claude` guess at the
  // same id turns it into an empty chat. Guessing `codex` for an unrecorded id
  // is what put "Codex history request failed" on a live chat after a
  // `git reset --hard` rewound the box's chat registry and husk card
  // (2026-09-03). Only a RECORDED `codex` reaches the RPC now.
  const engine = (await resolveRecordedChatEngine(boxRoot, { sessionId })) ?? "claude";
  const read = { boxRoot, engine, sessionId, slice };
  if (fresh) {
    return readHistory(read);
  }

  // The separator is NUL, spelled as an escape and never a literal (a raw NUL
  // in the source makes git treat the whole file as binary): it is a byte no
  // path, engine name or session id contains, so no read can spell another's key.
  const key = [boxRoot, engine, sessionId, sliceKey(slice)].join("\u0000");
  const running = inFlight.get(key);
  if (running) return running;

  // `.finally` before the map write, so the entry is gone the moment the read
  // settles — including when it throws. A read that failed must not be handed
  // to the next caller.
  const pending = readHistory(read).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}
