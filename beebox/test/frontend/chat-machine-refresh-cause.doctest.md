# Chat machine — `refreshing` remembers why it was entered

`refreshing` runs one history fetch, but the machine gets there two ways that
mean different things to the user. From `streaming` (STREAM_RESULT, a broken
stream, an interrupt, stall recovery) the agent just worked and the transcript
is being reconciled. From the global `REFRESH` — a WS (re)connect resync, a
`chat-complete` broadcast landing on an idle chat, a status poll that read idle
— nothing is running; it is a plain round-trip. `context.refreshCause` records
which, so the status strip (`processing-status-display.ts`) shows "Agent is
working…" only through the first kind. Before this, a REFRESH on an idle chat
painted the strip for the length of the fetch — the "opening a chat flashes
Agent working" bug.

```ts setup
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../src/frontend/src/machines/chatMachine.js";

// `pending` is the box's record of messages it accepted but has not yet
// written into the transcript (`chat.bootstrap`); a stubbed fetch has none.
const EMPTY = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };

// A started machine whose history fetch never settles, so `refreshing` stays
// observable.
async function idleActor() {
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => EMPTY),
        fetchHistory: fromPromise(() => new Promise(() => {})),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  await Promise.resolve();
  return actor;
}
const where = (actor) => `${actor.getSnapshot().value}/${actor.getSnapshot().context.refreshCause}`;
```

## The strip's phase follows the cause

```ts setup
import { chatDisplayPhase } from "../../src/frontend/src/components/chat/processing-status-display.js";
```

```ts
const actor = await idleActor();
actor.send({ type: "REFRESH" });
chatDisplayPhase(actor.getSnapshot())
=> refreshing-resync

const turn = await idleActor();
turn.send({ type: "SEND", message: "hi", messageId: "m1" });
turn.send({ type: "STREAM_RESULT" });
chatDisplayPhase(turn.getSnapshot())
=> refreshing-turn
```

## A REFRESH during `loading` is ignored

The reconnect gate's trailing timer can fire while `fetchInitial` is still in
flight (a >5s bootstrap). Honoring it would cancel that fetch; the load's own
result is fresher than any event the REFRESH could be covering for.

```ts
const actor = createActor(
  chatMachine.provide({
    actors: {
      fetchInitial: fromPromise(() => new Promise(() => {})),
      fetchHistory: fromPromise(async () => EMPTY),
      stream: fromCallback(() => {}),
    },
  }),
  { input: { sessionInput: "s1" } },
);
actor.start();
actor.send({ type: "REFRESH" });
actor.getSnapshot().value
=> loading
```

## A REFRESH from idle is a resync

```ts
const actor = await idleActor();
where(actor)
=> idle/resync

actor.send({ type: "REFRESH" });
where(actor)
=> refreshing/resync
```

## Every edge out of `streaming` is a turn refresh

```ts setup
async function afterTurn(terminal) {
  const actor = await idleActor();
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send(terminal);
  return where(actor);
}
```

```ts
await afterTurn({ type: "STREAM_RESULT" })
=> refreshing/turn

await afterTurn({ type: "STREAM_FAILED", error: "socket closed", accepted: true })
=> refreshing/turn

await afterTurn({ type: "STREAM_RECOVER" })
=> refreshing/turn
```

(An interrupted turn takes the STREAM_ERROR/STREAM_FAILED `interrupting`
branches, which mark the cause the same way; INTERRUPT itself posts to the
server, so it is not driven here.)

## A later resync does not inherit the turn's cause

`chat-complete` lands a beat after STREAM_RESULT and is ignored inside
`refreshing` (see chat-machine-finalize.doctest.md), so the turn's cause holds
through its own fetch; the *next* REFRESH, once idle, is a resync again.

```ts
const actor = await idleActor();
actor.send({ type: "SEND", message: "hi", messageId: "m1" });
actor.send({ type: "STREAM_RESULT" });
actor.send({ type: "REFRESH" });
where(actor)
=> refreshing/turn
```
