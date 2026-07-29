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

const EMPTY = { entries: [], total: 0, sessionId: "s1", running: false, busy: false };

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
