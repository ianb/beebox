// # Chat machine — a send during `loading` is queued, not swallowed
//
// The iOS shell delivers pending emissions on `didFinish`, which fires before
// the React app's `fetchInitial` resolves — so a SEND can land while the
// machine is still in `loading`. With no handler there the machine silently
// dropped the event: no POST, no receipt, and the shell's redelivery backoff
// painted duplicate rows (the 2026-08-19 voice-duplicate regression). `loading`
// now shares the queue-don't-interrupt SEND handling with `streaming` and
// `refreshing`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../../src/machines/chatMachine/machine.js";
import type { PendingSessionEntry, SessionEntry } from "../../../src/api-chat.js";
import type { SessionInput } from "../../../src/machines/chat-types.js";

interface Loaded {
  entries: SessionEntry[];
  total: number;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  pending: PendingSessionEntry[];
}

// `pending` is the box's record of messages it accepted but has not yet
// written into the transcript (`chat.bootstrap`); a stubbed fetch has none.
type History = Omit<Loaded, "pending">;

const EMPTY: Loaded = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };

// ## The optimistic entry appears while loading and survives fetchInitial
//
// `fetchInitial` is held open so `loading` stays observable, then released; the
// entry rides `pendingMessages` across `onDone`'s messages overwrite, so it
// stays visible until history reconciliation owns it.
void test("fetchInitial is held open so loading stays observable, then released; the ent...", async (t) => {
  // doctest:L40
  let releaseInitial = () => {};
  const initialGate = new Promise<Loaded>((resolve) => { releaseInitial = () => resolve(EMPTY); });
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(() => initialGate),
        fetchHistory: fromPromise<History, SessionInput>(async () => EMPTY),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  actor.send({ type: "SEND", message: "sent mid-load", messageId: "m-load-1" });
  const whileLoading = actor.getSnapshot();
  t.check(
    {
      state: whileLoading.value,
      pending: whileLoading.context.pendingMessages.map((m) => m.uuid),
      visible: whileLoading.context.messages.map((m) => m.uuid),
    },
    {
    state: "loading",
    pending: [
      "m-load-1",
    ],
    visible: [
      "m-load-1",
    ],
  },
  );

  // `fetchInitial`'s `onDone` reconciles instead of overwriting: the fetched
  // history predates the mid-load send, so the entry must stay in `messages`
  // (a plain overwrite blanked the row until the next refresh).

  // doctest:L68
  releaseInitial();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const settled = actor.getSnapshot();
  t.check(
    {
      state: settled.value,
      pending: settled.context.pendingMessages.map((m) => m.uuid),
      visible: settled.context.messages.map((m) => m.uuid),
    },
    {
    state: "idle",
    pending: [
      "m-load-1",
    ],
    visible: [
      "m-load-1",
    ],
  },
  );
});
