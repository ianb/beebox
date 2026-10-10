# Chat machine — the streamed bubble survives finalize

`chatMachine` keeps the streamed reply on screen across the `streaming →
refreshing → idle` handoff: `refreshing` holds `streamText` until its
`fetchHistory` lands, and the `onDone` swaps in the authoritative entry and
clears the stream in ONE `assign`. `InteractiveChat-messages.tsx` renders the
provisional bubble for as long as `streamText` is non-empty, so that atomic swap
is what makes finalize an in-place update instead of an unmount/remount
(`components/chat/AGENTS.md`, "Streaming → finalize").

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
import { chatMachine } from "../../../src/machines/chatMachine/machine.js";
import { applyStreamError, promoteLastToPending } from "../../../src/machines/chatMachine/chat-actions.js";

// `pending` is the box's record of messages it accepted but has not yet
// written into the transcript (`chat.bootstrap`); a stubbed fetch has none.
const EMPTY = { entries: [], total: 0, sessionId: "s1", running: false, busy: false, pending: [] };

// A started machine in `idle`. By default `fetchHistory` never settles, so a
// state under test stays observable; `historyCalls` counts invocations (a
// restarted fetch means the in-flight read was aborted, doubling the gap).
// Pass `history` to settle it, `initial` to seed the fetched transcript.
async function startMachine({ initial, history }: { initial?: typeof EMPTY; history?: typeof EMPTY } = {}) {
  const historyCalls: number[] = [];
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => initial ?? EMPTY),
        fetchHistory: fromPromise(() => {
          historyCalls.push(1);
          return history ? Promise.resolve(history) : new Promise(() => {});
        }),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "s1" } },
  );
  actor.start();
  await Promise.resolve();
  return { actor, historyCalls };
}

// Parked in `refreshing` with a streamed reply in hand.
async function inRefreshing() {
  const run = await startMachine();
  run.actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  run.actor.send({ type: "STREAM_TEXT", text: "the reply" });
  run.actor.send({ type: "STREAM_RESULT" });
  return run;
}
```

## A `chat-complete` `REFRESH` must not clear the streamed text

The regression: the global `REFRESH` handler used to fire in `refreshing`,
blanking `streamText` and re-entering `refreshing` (aborting and restarting the
fetch). The reply vanished from the DOM until the *second* roundtrip returned.

```ts
const { actor, historyCalls } = await inRefreshing();
actor.send({ type: "REFRESH" });
const after = actor.getSnapshot();
({ streamText: after.context.streamText, refreshing: after.matches("refreshing"), historyCalls: historyCalls.length })
=> { streamText: "the reply", refreshing: true, historyCalls: 1 }
```

## `REFRESH` still works from `idle`

The guard is scoped to the states that own a live stream — an idle tab
reacting to another tab's `chat-complete` still refetches.

```ts
const { actor } = await startMachine();
const before = actor.getSnapshot().matches("idle");
actor.send({ type: "REFRESH" });
({ idleBefore: before, refreshingAfter: actor.getSnapshot().matches("refreshing") })
=> { idleBefore: true, refreshingAfter: true }
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
const { actor } = await startMachine({ initial: { ...EMPTY, entries: [oldUser] } });
actor.send({ type: "SEND", message: "<typed>new</typed>", messageId: "m-new" });
const view = () => {
  const { messages, pendingMessages } = actor.getSnapshot().context;
  return { uuids: messages.map((entry) => entry.uuid), pending: pendingMessages.length };
};

actor.send({ type: "SET_MESSAGES", messages: [oldUser], sessionId: "s1" });
view()
=> { uuids: ["server-old", "«*»"], pending: 1 }

actor.send({ type: "SET_MESSAGES", messages: [oldUser, durableSend], sessionId: "s1" });
view()
=> { uuids: ["server-old", "server-new"], pending: 0 }
```

## Failure and queue promotion target the active emission, not the list tail

A second send can already be queued while the first send's start request is
still settling. Cleanup and promotion address the first turn by its stable
emission UUID; they must not mutate the newer queued entry merely because it
is last.

```ts
const { actor } = await startMachine();
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
failed.pendingMessages?.map((entry) => entry.uuid)
=> ["m-second"]

const promoted = promoteLastToPending({ context: overlappingContext });
({ messages: promoted.messages?.map((entry) => [entry.uuid, entry.pending === true]), pending: promoted.pendingMessages?.length })
=> { messages: [["m-first", true], ["m-second", true]], pending: 2 }
```

## A busy response promotes the already-tracked send to queued

Ordinary sends are tracked without queued styling. If the backend reports that
the turn was queued, `STREAM_QUEUED` promotes that same entry rather than
adding a second reconciliation record.

```ts
const { actor } = await startMachine();
const tracked = () => {
  const { pendingMessages } = actor.getSnapshot().context;
  return { count: pendingMessages.length, queued: pendingMessages[0]?.pending === true };
};
actor.send({ type: "SEND", message: "<typed>queued</typed>", messageId: "m-queued" });
tracked()
=> { count: 1, queued: false }

actor.send({ type: "STREAM_QUEUED" });
tracked()
=> { count: 1, queued: true }
```

## A send rejected before acceptance is not protected forever

`STREAM_FAILED accepted=false` means no durable entry can ever arrive. The
refresh may remove that optimistic bubble instead of re-appending a permanent,
undimmed ghost after every future snapshot.

```ts
const { actor } = await startMachine({ history: EMPTY });
actor.send({ type: "SEND", message: "<typed>rejected</typed>", messageId: "m-rejected" });
actor.send({ type: "STREAM_FAILED", error: "not accepted", accepted: false });
await Promise.resolve();
await Promise.resolve();
const { messages, pendingMessages } = actor.getSnapshot().context;
({ idle: actor.getSnapshot().matches("idle"), messages: messages.length, pending: pendingMessages.length })
=> { idle: true, messages: 0, pending: 0 }
```

## A wedged stream recovers via `STREAM_RECOVER` without dropping partial text

The stream watchdog (`useProcessingStatusPoll` in
`components/chat/processing-status-display.ts`) sends `STREAM_RECOVER` when the
server has been idle for several polls while the machine is still `streaming` —
the per-turn WS died and its terminal frame will never arrive. Recovery goes
through `refreshing`, the same finalize path as a healthy turn, so any partial
streamed text is held for the history swap rather than blanked.

```ts
const { actor, historyCalls } = await startMachine();
actor.send({ type: "SEND", message: "hi", messageId: "m1" });
actor.send({ type: "STREAM_TEXT", text: "partial reply before the socket died" });
const streaming = actor.getSnapshot().matches("streaming");

actor.send({ type: "STREAM_RECOVER" });
const recovered = actor.getSnapshot();
({ streaming, refreshing: recovered.matches("refreshing"), streamText: recovered.context.streamText, historyCalls: historyCalls.length })
=> { streaming: true, refreshing: true, streamText: "partial reply before the socket died", historyCalls: 1 }
```
