# Chat machine — the streamed bubble survives finalize

`chatMachine` keeps the streamed reply on screen across the `streaming →
refreshing → idle` handoff: `refreshing` holds `streamText` until its
`fetchHistory` lands, and the `onDone` swaps in the authoritative entry and
clears the stream in ONE `assign`. `InteractiveChat-messages.tsx` renders the
provisional bubble for as long as `streamText` is non-empty, so that atomic swap
is what makes finalize an in-place update instead of an unmount/remount
(`components/chat/CLAUDE.md`, "Streaming → finalize").

The event that threatens it is `REFRESH`. The backend broadcasts
`chat-complete` on its global bus the moment a turn ends, and
`InteractiveChat-ws.ts` turns that into a `REFRESH` — which arrives a beat
*after* `STREAM_RESULT` has already moved us into `refreshing`. `streaming`
guards against it explicitly; `refreshing` must too, or the global `REFRESH`
handler clears `streamText` mid-flight, the bubble unmounts, the chat collapses
to the user message for a roundtrip, and the scroll controller rides the shrink
up to the top of the turn.

That extra fetch buys nothing here: `waitForTranscriptEntry`
(`core/chat/session/transcript-sync.ts`) blocks `result`/`done` until the turn
is durable on disk, so the `fetchHistory` already in flight reads a complete
transcript.

```ts setup
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../src/frontend/src/machines/chatMachine.js";
import { applyStreamError, promoteLastToPending } from "../../src/frontend/src/machines/chat-actions.js";

// `pending` is the box's record of messages it accepted but has not yet
// written into the transcript (`chat.bootstrap`); a stubbed fetch has none.
const EMPTY = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };

// A started machine parked in `refreshing` with a streamed reply in hand:
// `fetchHistory` never settles, so the state under test stays observable.
// `historyCalls` counts invocations — a restarted fetch is the second half of
// the bug (the in-flight read is aborted, doubling the gap).
async function inRefreshing() {
  const historyCalls = [];
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => EMPTY),
        fetchHistory: fromPromise(() => {
          historyCalls.push(1);
          return new Promise(() => {});
        }),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  await Promise.resolve();
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send({ type: "STREAM_TEXT", text: "the reply" });
  actor.send({ type: "STREAM_RESULT" });
  return { actor, historyCalls };
}
```

## The streamed text is held through `refreshing`

```ts
const { actor, historyCalls } = await inRefreshing();
const s = actor.getSnapshot();
s.matches("refreshing")
=> true

s.context.streamText
=> the reply

historyCalls.length
=> 1
```

## A `chat-complete` `REFRESH` must not clear it

The regression: the global `REFRESH` handler used to fire here, blanking
`streamText` and re-entering `refreshing` (aborting and restarting the fetch).
The reply vanished from the DOM until the *second* roundtrip returned.

```ts continue
actor.send({ type: "REFRESH" });
const after = actor.getSnapshot();
after.context.streamText
=> the reply

after.matches("refreshing")
=> true

historyCalls.length
=> 1
```

## `REFRESH` still works from `idle`

The guard is scoped to the states that own a live stream — an idle tab
reacting to another tab's `chat-complete` still refetches.

```ts
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
actor.getSnapshot().matches("idle")
=> true

actor.send({ type: "REFRESH" });
actor.getSnapshot().matches("refreshing")
=> true
```

## An intermediate server snapshot cannot erase the active optimistic send

`chat-history` is delivered as the global `SET_MESSAGES` event, including
while the machine is streaming. Its snapshot can predate the active send. The
optimistic user entry must remain visible until a later snapshot contains its
durable counterpart; that later reconciliation must replace it exactly once.

```ts
const oldUser = {
  uuid: "server-old",
  type: "user" as const,
  timestamp: "2026-01-01T00:00:00Z",
  content: [{ type: "text" as const, text: "<typed>old</typed>" }],
};
const durableSend = {
  uuid: "server-new",
  type: "user" as const,
  timestamp: "2026-01-01T00:00:01Z",
  content: [{ type: "text" as const, text: "<typed>new</typed>" }],
};
const actor = createActor(
  chatMachine.provide({
    actors: {
      fetchInitial: fromPromise(async () => ({ ...EMPTY, entries: [oldUser] })),
      fetchHistory: fromPromise(() => new Promise(() => {})),
      stream: fromCallback(() => {}),
    },
  }),
  { input: { sessionInput: "s1" } },
);
actor.start();
await Promise.resolve();
actor.send({ type: "SEND", message: "<typed>new</typed>", messageId: "m-new" });

actor.send({ type: "SET_MESSAGES", messages: [oldUser], sessionId: "s1" });
JSON.stringify(actor.getSnapshot().context.messages.map((entry) => entry.uuid))
=> ["server-old","«*»"]

actor.getSnapshot().context.pendingMessages.length
=> 1

actor.send({ type: "SET_MESSAGES", messages: [oldUser, durableSend], sessionId: "s1" });
JSON.stringify(actor.getSnapshot().context.messages.map((entry) => entry.uuid))
=> ["server-old","server-new"]

actor.getSnapshot().context.pendingMessages.length
=> 0
```

## Failure and queue promotion target the active emission, not the list tail

A second send can already be queued while the first send's start request is
still settling. Cleanup and promotion address the first turn by its stable
emission UUID; they must not mutate the newer queued entry merely because it
is last.

```ts
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
actor.send({ type: "SEND", message: "<typed>first</typed>", messageId: "m-first" });
const activeContext = actor.getSnapshot().context;
const active = activeContext.pendingMessages[0]!;
const queued = { ...active, uuid: "m-second", pending: true };
const overlappingContext = {
  ...activeContext,
  messages: [...activeContext.messages, queued],
  pendingMessages: [active, queued],
};

const failed = applyStreamError({
  context: overlappingContext,
  event: { type: "STREAM_FAILED", error: "not accepted", accepted: false },
});
JSON.stringify(failed.pendingMessages?.map((entry) => entry.uuid))
=> ["m-second"]

const promoted = promoteLastToPending({ context: overlappingContext });
JSON.stringify(promoted.messages?.map((entry) => [entry.uuid, entry.pending === true]))
=> [["m-first",true],["m-second",true]]

promoted.pendingMessages?.length
=> 2
```

## A busy response promotes the already-tracked send to queued

Ordinary sends are tracked without queued styling. If the backend reports that
the turn was queued, `STREAM_QUEUED` promotes that same entry rather than
adding a second reconciliation record.

```ts
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
actor.send({ type: "SEND", message: "<typed>queued</typed>", messageId: "m-queued" });
actor.getSnapshot().context.pendingMessages[0]?.pending === true
=> false

actor.send({ type: "STREAM_QUEUED" });
actor.getSnapshot().context.pendingMessages.length
=> 1

actor.getSnapshot().context.pendingMessages[0]?.pending
=> true
```

## A send rejected before acceptance is not protected forever

`STREAM_FAILED accepted=false` means no durable entry can ever arrive. The
refresh may remove that optimistic bubble instead of re-appending a permanent,
undimmed ghost after every future snapshot.

```ts
const actor = createActor(
  chatMachine.provide({
    actors: {
      fetchInitial: fromPromise(async () => EMPTY),
      fetchHistory: fromPromise(async () => EMPTY),
      stream: fromCallback(() => {}),
    },
  }),
  { input: { sessionInput: "s1" } },
);
actor.start();
await Promise.resolve();
actor.send({ type: "SEND", message: "<typed>rejected</typed>", messageId: "m-rejected" });
actor.send({ type: "STREAM_FAILED", error: "not accepted", accepted: false });
await Promise.resolve();
await Promise.resolve();

actor.getSnapshot().matches("idle")
=> true

actor.getSnapshot().context.messages.length
=> 0

actor.getSnapshot().context.pendingMessages.length
=> 0
```

## A wedged stream recovers via `STREAM_RECOVER` without dropping partial text

The stream watchdog (`useProcessingStatusPoll` in
`components/chat/processing-status-display.ts`) sends `STREAM_RECOVER` when the
server has been idle for several polls while the machine is still `streaming` —
the per-turn WS died and its terminal frame will never arrive. Recovery goes
through `refreshing`, the same finalize path as a healthy turn, so any partial
streamed text is held for the history swap rather than blanked.

```ts
const historyCalls = [];
const actor = createActor(
  chatMachine.provide({
    actors: {
      fetchInitial: fromPromise(async () => EMPTY),
      fetchHistory: fromPromise(() => {
        historyCalls.push(1);
        return new Promise(() => {});
      }),
      stream: fromCallback(() => {}),
    },
  }),
  { input: { sessionInput: "s1" } },
);
actor.start();
await Promise.resolve();
actor.send({ type: "SEND", message: "hi", messageId: "m1" });
actor.send({ type: "STREAM_TEXT", text: "partial reply before the socket died" });
actor.getSnapshot().matches("streaming")
=> true

actor.send({ type: "STREAM_RECOVER" });
const recovered = actor.getSnapshot();
recovered.matches("refreshing")
=> true

recovered.context.streamText
=> partial reply before the socket died

historyCalls.length
=> 1
```
