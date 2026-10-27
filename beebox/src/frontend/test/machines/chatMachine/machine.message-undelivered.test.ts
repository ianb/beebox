// # Chat machine — a send the agent never got is marked not delivered
//
// `docs/plans/chat-not-delivered.md`, Track 2. The box reports a send it
// dropped from a stopped queue (`chat-user-message-undelivered` →
// MESSAGE_UNDELIVERED); a tab with no copy of that send refetches the box's
// accepted list; and a queued send the box refuses outright is marked here,
// since the box recorded nothing to report later.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { createActor, fromCallback, fromPromise } from "xstate";
import { chatMachine } from "../../../src/machines/chatMachine/machine.js";
import * as apiChat from "../../../src/api-chat.js";
import { ChatSendRejectedError, type PendingSessionEntry, type SessionEntry } from "../../../src/api-chat.js";
import * as api from "../../../src/api.js";
import type * as Machine from "../../../src/machines/chatMachine/machine.js";
import type { ChatContext, SessionInput } from "../../../src/machines/chat-types.js";

const HISTORY: SessionEntry[] = [{ uuid: "t1", type: "user", timestamp: "2026-10-27T09:00:00Z", content: [{ type: "text", text: "<typed>hi</typed>" }] }];
interface Loaded {
  entries: SessionEntry[];
  total: number;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  pending: PendingSessionEntry[];
}
const LOADED: Loaded = { entries: HISTORY, total: 1, sessionId: "s1", running: true, busy: false, pending: [] };

/** A machine past loading, with `refetched` standing in for the box's accepted list. */
async function loadedMachine(refetched: PendingSessionEntry[]) {
  const machine = chatMachine.provide({
    actors: {
      fetchInitial: fromPromise(async () => LOADED),
      fetchHistory: fromPromise<Omit<Loaded, "pending">, SessionInput>(async () => LOADED),
      stream: fromCallback(() => {}),
    },
    actions: { refetchAccepted: ({ self }) => { queueMicrotask(() => self.send({ type: "ACCEPTED_REFETCHED", accepted: refetched })); } },
  });
  const actor = createActor(machine, { input: { sessionInput: "s1" } });
  actor.start();
  await eventually(() => actor.getSnapshot().value === "idle", { label: "loaded" });
  return actor;
}

function faces(context: ChatContext) {
  return context.messages.map((entry) => ({ uuid: entry.uuid, pending: entry.pending, undelivered: entry.undelivered, sendRefused: entry.sendRefused }));
}

// The send went out while a reply streamed, so it is queued; the restart
// dropped it. Its optimistic copy's uuid is its message id.
void test("the queued copy of a dropped send is marked", async (t) => {
  const actor = await loadedMachine([]);
  t.teardown(() => actor.stop());
  actor.send({ type: "SEND", message: "<typed>first</typed>", messageId: "m-live" });
  actor.send({ type: "STREAM_QUEUED" });
  actor.send({ type: "MESSAGE_UNDELIVERED", messageId: "m-live" });
  t.check(faces(actor.getSnapshot().context), [
    { uuid: "t1", pending: undefined, undelivered: undefined, sendRefused: undefined },
    { uuid: "m-live", pending: true, undelivered: true, sendRefused: undefined },
  ]);
});

// Another user's message arrived as a live broadcast copy, which is not
// pending. The box's accepted copy, marked, takes its place.
void test("a send this tab holds no entry for comes back from the accepted list", async (t) => {
  const fromBox: PendingSessionEntry = {
    uuid: "accepted-7", type: "user", timestamp: "2026-10-27T10:00:00Z", content: [{ type: "text", text: "<typed user=\"Bob\">milk</typed>" }],
    user: "Bob", messageId: "m-bob", undelivered: true, reconcileKnownUuids: ["t1"],
  };
  const actor = await loadedMachine([fromBox]);
  t.teardown(() => actor.stop());
  actor.send({ type: "OTHER_USER_MESSAGE", message: "<typed user=\"Bob\">milk</typed>", userName: "Bob", timestamp: "2026-10-27T10:00:00Z", messageId: "m-bob" });
  actor.send({ type: "MESSAGE_UNDELIVERED", messageId: "m-bob" });
  await eventually(() => actor.getSnapshot().context.pendingMessages.length > 0, { label: "accepted list merged" });
  t.check(faces(actor.getSnapshot().context), [
    { uuid: "t1", pending: undefined, undelivered: undefined, sendRefused: undefined },
    { uuid: "accepted-7", pending: undefined, undelivered: true, sendRefused: undefined },
  ]);
});

// The box answers a queued send with a 4xx: a definitive refusal
// (`ChatSendRejectedError`), so nothing was recorded and nothing will arrive.
// The POST is stubbed at `api.ts`: `startChatTurn` needs Vite's environment.
void test("a queued send the box refuses is marked here", async (t) => {
  const { chatMachine: refusingMachine } = await t.mockImport<typeof Machine>("../../../src/machines/chatMachine/machine.ts", {
    // One copy of the error class on both sides, so `instanceof` holds.
    "../../../src/api-chat.ts": apiChat,
    "../../../src/api.ts": { ...api, startChatTurn: async ({ messageId }: { messageId?: string }) => {
      if (messageId === "m-queued") throw new ChatSendRejectedError("Message refused");
      return { turnId: "turn-1" };
    } },
  });
  const actor = createActor(refusingMachine.provide({
    actors: {
      fetchInitial: fromPromise(async () => LOADED),
      fetchHistory: fromPromise<Omit<Loaded, "pending">, SessionInput>(async () => LOADED),
      stream: fromCallback(() => {}),
    },
  }), { input: { sessionInput: "s1" } });
  actor.start();
  t.teardown(() => actor.stop());
  await eventually(() => actor.getSnapshot().value === "idle", { label: "loaded" });
  actor.send({ type: "SEND", message: "<typed>first</typed>", messageId: "m-live" });
  actor.send({ type: "SEND", message: "<typed>second</typed>", messageId: "m-queued" });
  await eventually(() => actor.getSnapshot().context.messages.some((entry) => entry.undelivered === true), { label: "refused send marked" });
  t.check(faces(actor.getSnapshot().context).at(-1), { uuid: "m-queued", pending: true, undelivered: true, sendRefused: true });
});
