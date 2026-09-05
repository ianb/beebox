# `POST /api/chat/send` — a run that fails to start is accepted, and says so on the turn stream

Acceptance is the durable record, not the engine spawn. The route persists the
user message + the message-id claim and answers `{turnId}` immediately; the run
starts afterwards, with nothing awaiting it
(`docs/implemented-plans/emission-model.md`, Track A).

So a run that fails to start (an SDK spawn hitting the file-descriptor ceiling —
`issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`) can no longer
be reported as an HTTP status: by then the client has its `200 {turnId}` and is
subscribed to the turn's stream. The failure is delivered *there*, as the turn
buffer's error frame, which the client renders as a failed turn without offering
the text back — the message really is in history, and handing it back would
invite the double-record this route once produced.

For the same reason the message-id claim is **kept**, not released: a redelivery
of that id must be answered `deduplicated: true`, because the box does have the
message.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { createFakeChatBackend, type FakeChatBackend } from "../../src/services/claude-chat.js";
import { getTurnBuffer } from "../../src/core/chat/turn-buffer.js";
import type { BusEvent } from "../../src/core/event-bus.js";

/**
 * The response arrives before the run does, so the error frame lands a moment
 * later. Await the buffer's own change signal instead of imposing a second,
 * load-sensitive polling deadline on the operation.
 */
async function awaitTurnCompletion(turnId: unknown) {
  const buffer = getTurnBuffer(String(turnId));
  if (buffer === undefined) throw new Error("turn buffer was not created before the ack");
  while (!buffer.complete) {
    const version = buffer.versionSnapshot();
    await buffer.waitForChange(undefined, version);
  }
  return buffer;
}

/** Await the fake's real start boundary; the file-level timeout catches hangs. */
async function awaitFakeRuns(backend: FakeChatBackend, count: number): Promise<void> {
  while (backend.runs.length < count) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}
```

## A failed run start: 200 with a turnId, and the failure on that turn

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

backend.failNextStart = Object.assign(new Error("spawn EBADF"), { code: "EBADF" });
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
});
const turn = await awaitTurnCompletion(res.body.turnId);
const failure = turn.errored ?? "(no error frame)";

`${res.statusCode} | turn=${typeof res.body.turnId} | recorded=${recorded.length} | errored=${failure} | complete=${turn.complete}`
=> 200 | turn=string | recorded=1 | errored=spawn EBADF | complete=true
```

## Retrying the same messageId is deduplicated — the message is already here

The client was told the box has this message, and it does. A retry (an iOS
redelivery on relaunch, say) must not append a second copy of it to history.

```ts continue
const retry = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
});

`${retry.statusCode} | dedup=${retry.body.deduplicated} | recorded=${recorded.length}`
=> 200 | dedup=true | recorded=1
```

```ts cleanup
await ctx.cleanup();
```

## A successful send still records exactly one user message

The reorder must not lose the event on the happy path — the pending-UI echo in
every other open tab rides on it.

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "water the plants", messageId: "m2" },
});
await awaitFakeRuns(backend, 1);

`${res.statusCode} | recorded=${recorded.length} | ${recorded[0]}`
=> 200 | recorded=1 | water the plants
```

```ts cleanup
await ctx.cleanup();
```

## A duplicate messageId arriving after a *successful* send is still deduped

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "hi", messageId: "m3" },
});
const again = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "hi", messageId: "m3" },
});
await awaitFakeRuns(backend, 1);

`${again.statusCode} | dedup=${again.body.deduplicated} | recorded=${recorded.length}`
=> 200 | dedup=true | recorded=1
```

```ts cleanup
await ctx.cleanup();
```
