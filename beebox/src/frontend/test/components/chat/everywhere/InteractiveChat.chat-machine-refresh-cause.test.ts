// # Chat machine — `refreshing` remembers why it was entered
//
// `refreshing` runs one history fetch, but the machine gets there two ways that
// mean different things to the user. From `streaming` (STREAM_RESULT, a broken
// stream, an interrupt, stall recovery) the agent just worked and the transcript
// is being reconciled. From the global `REFRESH` — a WS (re)connect resync, a
// `chat-complete` broadcast landing on an idle chat, a status poll that read idle
// — nothing is running; it is a plain round-trip. `context.refreshCause` records
// which, so the status strip (`processing-status-display.ts`) shows "Agent is
// working…" only through the first kind. Before this, a REFRESH on an idle chat
// painted the strip for the length of the fetch — the "opening a chat flashes
// Agent working" bug.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../../../src/machines/chatMachine/machine.js";
import type { ChatController } from "../../../../src/components/chat/conversation/controller-pool/pool.js";
import type { SessionEntry, PendingSessionEntry } from "../../../../src/api.js";
import type { ChatEvent } from "../../../../src/machines/chat-types.js";
import { chatDisplayPhase } from "../../../../src/components/chat/everywhere/InteractiveChat/processing-status-display.js";

// `pending` is the box's record of messages it accepted but has not yet
// written into the transcript (`chat.bootstrap`); a stubbed fetch has none.
interface Loaded { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean; pending: PendingSessionEntry[] }
const EMPTY: Loaded = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };
// `fetchHistory` carries no `pending` list.
const HISTORY = { entries: EMPTY.entries, total: 0, sessionId: EMPTY.sessionId, running: false, busy: false };

// A started machine whose history fetch never settles, so `refreshing` stays
// observable.
async function idleActor(): Promise<ChatController> {
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => EMPTY),
        fetchHistory: fromPromise(() => new Promise<typeof HISTORY>(() => {})),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  await Promise.resolve();
  return actor;
}
const where = (actor: ChatController) => `${actor.getSnapshot().value}/${actor.getSnapshot().context.refreshCause}`;

// ## The strip's phase follows the cause
// ## Every edge out of `streaming` is a turn refresh
async function afterTurn(terminal: ChatEvent) {
  const actor = await idleActor();
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send(terminal);
  return where(actor);
}

void test("The strip's phase follows the cause", async (t) => {
  const actor = await idleActor();
  actor.send({ type: "REFRESH" });
  t.check(chatDisplayPhase(actor.getSnapshot()), "refreshing-resync");

  const turn = await idleActor();
  turn.send({ type: "SEND", message: "hi", messageId: "m1" });
  turn.send({ type: "STREAM_RESULT" });
  t.check(chatDisplayPhase(turn.getSnapshot()), "refreshing-turn");
});

// ## A REFRESH during `loading` is ignored
//
// The reconnect gate's trailing timer can fire while `fetchInitial` is still in
// flight (a >5s bootstrap). Honoring it would cancel that fetch; the load's own
// result is fresher than any event the REFRESH could be covering for.
void test("The reconnect gate's trailing timer can fire while fetchInitial is still in f...", async (t) => {
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(() => new Promise<Loaded>(() => {})),
        fetchHistory: fromPromise(async () => HISTORY),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  actor.send({ type: "REFRESH" });
  t.check(actor.getSnapshot().value, "loading");
});

// ## A REFRESH from idle is a resync
void test("A REFRESH from idle is a resync", async (t) => {
  const actor = await idleActor();
  t.check(where(actor), "idle/resync");

  actor.send({ type: "REFRESH" });
  t.check(where(actor), "refreshing/resync");
});

void test("Every edge out of `streaming` is a turn refresh", async (t) => {
  t.check(await afterTurn({ type: "STREAM_RESULT" }), "refreshing/turn");

  t.check(await afterTurn({ type: "STREAM_FAILED", error: "socket closed", accepted: true }), "refreshing/turn");

  t.check(await afterTurn({ type: "STREAM_RECOVER" }), "refreshing/turn");
});

// (An interrupted turn takes the STREAM_ERROR/STREAM_FAILED `interrupting`
// branches, which mark the cause the same way; INTERRUPT itself posts to the
// server, so it is not driven here.)
//
// ## A later resync does not inherit the turn's cause
//
// `chat-complete` lands a beat after STREAM_RESULT and is ignored inside
// `refreshing` (see chat-machine-finalize.doctest.md), so the turn's cause holds
// through its own fetch; the *next* REFRESH, once idle, is a resync again.
void test("(An interrupted turn takes the STREAMERROR/STREAMFAILED interrupting branches...", async (t) => {
  const actor = await idleActor();
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send({ type: "STREAM_RESULT" });
  actor.send({ type: "REFRESH" });
  t.check(where(actor), "refreshing/turn");
});
