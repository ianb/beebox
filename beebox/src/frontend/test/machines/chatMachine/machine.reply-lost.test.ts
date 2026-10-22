// # Chat machine — a dropped live reply waits for history before alarming
//
// The turn stream is a live view of a turn the box already accepted. When that
// view drops (the websocket client's "Active connection is not open", or a
// stream that ends with no result), the box may still be working, and the reply
// may already be in history. Before this, the drop set `error` at once, so chat
// showed a danger bar even when the reply arrived a moment later
// (issues/bugs/2026-08-25-one-pink-bar-three-severities.md). Now STREAM_LOST sets
// only `replyLost`, and the history refresh that follows settles it
// (`settleLostReply`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../../src/machines/chatMachine/machine.js";
import type { ChatController } from "../../../src/components/chat/conversation/controller-pool/pool.js";
import type { SessionEntry, PendingSessionEntry } from "../../../src/api.js";

interface History { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean }
// `pending` is the box's record of accepted, not yet transcribed messages; none here.
const LOADED: History & { pending: PendingSessionEntry[] } = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };

const entry = ({ uuid, type, text }: { uuid: string; type: SessionEntry["type"]; text: string }): SessionEntry =>
  ({ uuid, type, timestamp: "2026-10-17T00:00:00.000Z", content: [{ type: "text", text }] });
const question = entry({ uuid: "m1", type: "user", text: "hi" });

// A started chat whose refreshes return `history`, in order; the last repeats.
async function chatWith(...history: History[]): Promise<ChatController> {
  let call = 0;
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => LOADED),
        fetchHistory: fromPromise(async () => {
          const next = history[Math.min(call++, history.length - 1)];
          if (next === undefined) throw new Error("chatWith needs at least one history");
          return next;
        }),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  await Promise.resolve();
  return actor;
}
const settled = async (actor: ChatController) => {
  await eventually(() => actor.getSnapshot().value === "idle", { label: "refresh settled" });
  const { replyLost, error } = actor.getSnapshot().context;
  return { replyLost, error };
};
const dropMidTurn = (actor: ChatController) => {
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send({ type: "STREAM_LOST", reason: "Active connection is not open" });
};

// ## The reply landed: nothing is shown
//
// The first night's case: the drop was transient and the answer is in history.
void test("The first night's case:", async (t) => {
  const actor = await chatWith({ entries: [question, entry({ uuid: "a1", type: "assistant", text: "hello" })], total: 2, sessionId: "s1", running: true, busy: false });
  dropMidTurn(actor);
  t.check(await settled(actor), {
    replyLost: false,
    error: null,
  });
});

// ## The box is still working: a warning, settled by the next refresh
//
// `replyLost` stays true (the bar shows it as a warning) until a later refresh,
// such as the one `chat-complete` triggers, finds the reply.
void test("replyLost stays true (the bar shows it as a warning) until a later refresh, s...", async (t) => {
  const actor = await chatWith(
    { entries: [question], total: 1, sessionId: "s1", running: true, busy: true },
    { entries: [question, entry({ uuid: "a1", type: "assistant", text: "hello" })], total: 2, sessionId: "s1", running: true, busy: false },
  );
  dropMidTurn(actor);
  t.check(await settled(actor), {
    replyLost: true,
    error: null,
  });

  actor.send({ type: "REFRESH" });
  t.check(await settled(actor), {
    replyLost: false,
    error: null,
  });
});

// ## The reply landed while a later turn runs: nothing is shown
//
// `busy` covers the whole session, so a queued next turn keeps the box busy after
// the dropped turn's reply is already in history. The reply is checked first.
void test("busy covers the whole session, so a queued next turn keeps the box busy after...", async (t) => {
  const actor = await chatWith({ entries: [question, entry({ uuid: "a1", type: "assistant", text: "hello" })], total: 2, sessionId: "s1", running: true, busy: true });
  dropMidTurn(actor);
  t.check(await settled(actor), {
    replyLost: false,
    error: null,
  });
});

// ## The box stopped with no reply: an error
//
// A subprocess that exits mid-turn also ends the stream with no result. History
// then ends on the question, and the box is idle, so the message got no answer.
void test("A subprocess that exits mid-turn also ends the stream with no result.", async (t) => {
  const actor = await chatWith({ entries: [question], total: 1, sessionId: "s1", running: false, busy: false });
  dropMidTurn(actor);
  t.check(await settled(actor), {
    replyLost: false,
    error: "The box stopped before it answered. Send your message again.",
  });
});

// A started chat whose refreshes are held until the test releases each one, so
// an event can land between a history read and its onDone.
async function gatedChat(): Promise<{ actor: ChatController; reads: History[]; release: (history: History) => void }> {
  const waiting: Array<(history: History) => void> = [];
  const reads: History[] = [];
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => LOADED),
        fetchHistory: fromPromise(() => new Promise<History>((resolve) => { waiting.push(resolve); })),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  await Promise.resolve();
  const release = (history: History): void => {
    const next = waiting.shift();
    if (next === undefined) throw new Error("no fetch is waiting");
    reads.push(history);
    next(history);
  };
  return { actor, reads, release };
}
const fetchWaiting = async (actor: ChatController) => {
  await eventually(() => actor.getSnapshot().value === "refreshing", { label: "fetch in flight" });
};
const stillWorking: History = { entries: [question], total: 1, sessionId: "s1", running: true, busy: true };
const answered: History = { entries: [question, entry({ uuid: "a1", type: "assistant", text: "hello" })], total: 2, sessionId: "s1", running: true, busy: false };

// ## chat-complete during the drop's refresh is held, not lost
//
// The drop's refresh read history before the reply landed (busy, no reply);
// `chat-complete` (REFRESH) arrives while that read is in flight. `refreshing`
// does not restart its fetch, but it remembers the REFRESH, and once the stale
// read settles the machine fetches once more and finds the reply.
void test("chat-complete during the drop's refresh triggers one more fetch", async (t) => {
  const { actor, release } = await gatedChat();
  dropMidTurn(actor);
  await fetchWaiting(actor);
  actor.send({ type: "REFRESH" });
  t.check(actor.getSnapshot().context.refreshAgain, true);
  release(stillWorking);
  await eventually(() => actor.getSnapshot().value === "refreshing" && !actor.getSnapshot().context.refreshAgain, { label: "second fetch in flight" });
  release(answered);
  t.check({ ...(await settled(actor)), refreshAgain: actor.getSnapshot().context.refreshAgain }, { replyLost: false, error: null, refreshAgain: false });
});

// ## REFRESH during an ordinary refresh still does nothing
//
// The finalize path (STREAM_RESULT → refreshing, then chat-complete) keeps
// ignoring REFRESH: no flag, and exactly one fetch.
void test("REFRESH during a refresh with no lost reply is ignored", async (t) => {
  const { actor, reads, release } = await gatedChat();
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send({ type: "STREAM_RESULT" });
  await fetchWaiting(actor);
  actor.send({ type: "REFRESH" });
  t.check(actor.getSnapshot().context.refreshAgain, false);
  release(answered);
  t.check(await settled(actor), { replyLost: false, error: null });
  t.check(reads.map((history) => history.total), [2]);
});

// ## chat-complete during a read whose history is stale but status is idle
//
// History and status are read concurrently, so history can predate the reply
// while status already says the box is idle. Settled alone, that read shows
// "the box stopped before it answered". With a held REFRESH it settles
// nothing; the extra fetch finds the reply, and no error shows at any point.
void test("A held REFRESH keeps a stale idle read from showing the no-reply error", async (t) => {
  const { actor, release } = await gatedChat();
  const errors: Array<string | null> = [];
  actor.subscribe((snapshot) => { errors.push(snapshot.context.error); });
  dropMidTurn(actor);
  await fetchWaiting(actor);
  actor.send({ type: "REFRESH" });
  release({ ...stillWorking, running: false, busy: false });
  await eventually(() => actor.getSnapshot().value === "refreshing" && !actor.getSnapshot().context.refreshAgain, { label: "second fetch in flight" });
  t.check(actor.getSnapshot().context.replyLost, true);
  release(answered);
  t.check(await settled(actor), { replyLost: false, error: null });
  t.check(errors.filter((error) => error !== null), []);
});
