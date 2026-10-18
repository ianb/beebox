# Chat machine — a dropped live reply waits for history before alarming

The turn stream is a live view of a turn the box already accepted. When that
view drops (the websocket client's "Active connection is not open", or a
stream that ends with no result), the box may still be working, and the reply
may already be in history. Before this, the drop set `error` at once, so chat
showed a danger bar even when the reply arrived a moment later
(issues/bugs/2026-08-25-one-pink-bar-three-severities.md). Now STREAM_LOST sets
only `replyLost`, and the history refresh that follows settles it
(`settleLostReply`).

```ts setup
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../../src/machines/chatMachine/machine.js";
import type { ChatController } from "../../../src/components/chat/conversation/controller-pool/pool.js";
import type { SessionEntry, PendingSessionEntry } from "../../../src/api.js";

interface History { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean }
// `pending` is the box's record of accepted, not yet transcribed messages; none here.
const LOADED: History & { pending: PendingSessionEntry[] } = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };

const entry = (uuid: string, type: SessionEntry["type"], text: string): SessionEntry =>
  ({ uuid, type, timestamp: "2026-10-17T00:00:00.000Z", content: [{ type: "text", text }] });
const question = entry("m1", "user", "hi");

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
```

## The reply landed: nothing is shown

The first night's case: the drop was transient and the answer is in history.

```ts
const actor = await chatWith({ entries: [question, entry("a1", "assistant", "hello")], total: 2, sessionId: "s1", running: true, busy: false });
dropMidTurn(actor);
await settled(actor)
=> { replyLost: false, error: null }
```

## The box is still working: a warning, settled by the next refresh

`replyLost` stays true (the bar shows it as a warning) until a later refresh,
such as the one `chat-complete` triggers, finds the reply.

```ts
const actor = await chatWith(
  { entries: [question], total: 1, sessionId: "s1", running: true, busy: true },
  { entries: [question, entry("a1", "assistant", "hello")], total: 2, sessionId: "s1", running: true, busy: false },
);
dropMidTurn(actor);
await settled(actor)
=> { replyLost: true, error: null }
```

```ts continue
actor.send({ type: "REFRESH" });
await settled(actor)
=> { replyLost: false, error: null }
```

## The reply landed while a later turn runs: nothing is shown

`busy` covers the whole session, so a queued next turn keeps the box busy after
the dropped turn's reply is already in history. The reply is checked first.

```ts
const actor = await chatWith({ entries: [question, entry("a1", "assistant", "hello")], total: 2, sessionId: "s1", running: true, busy: true });
dropMidTurn(actor);
await settled(actor)
=> { replyLost: false, error: null }
```

## The box stopped with no reply: an error

A subprocess that exits mid-turn also ends the stream with no result. History
then ends on the question, and the box is idle, so the message got no answer.

```ts
const actor = await chatWith({ entries: [question], total: 1, sessionId: "s1", running: false, busy: false });
dropMidTurn(actor);
await settled(actor)
=> { replyLost: false, error: "The box stopped before it answered. Send your message again." }
```
