# `POST /api/chat/send` — a run that fails to start records nothing

`chat-user-message` is a **persisted** event: it is the user's turn in the
conversation history. It used to be emitted before `chatSession.send()`, so a
run that failed to start (an SDK spawn hitting the file-descriptor ceiling —
`issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`) left a
message in history that the agent never received, while the 500 told the client
the send had failed and handed the text back for a retry — which recorded it a
second time. The message is now recorded only once it is genuinely on its way.

The `messageId` claim is the mirror image: it is taken up front, so it still
guards a concurrent double-submit, but it is *released* when the send doesn't
land — otherwise the retry the client is being invited to make would be answered
`deduplicated: true` and silently dropped.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import type { BusEvent } from "../../src/core/event-bus.js";
```

## A failed run start: 500, and no user message in history

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

`${res.statusCode} | recorded=${recorded.length}`
=> 500 | recorded=0
```

```ts cleanup
await ctx.cleanup();
```

## Retrying with the same messageId is not swallowed

The client's own retry path reuses the id. A claim that outlived the failure
would turn the retry into a no-op `deduplicated: true` and lose the message
outright — a worse failure than the duplicate it was meant to prevent.

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

backend.failNextStart = new Error("spawn EBADF");
const first = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "hello", messageId: "m1" },
});
const retry = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "hello", messageId: "m1" },
});

`${first.statusCode} | ${retry.statusCode} | turn=${typeof retry.body.turnId} | recorded=${recorded.length}`
=> 500 | 200 | turn=string | recorded=1
```

```ts cleanup
await ctx.cleanup();
```

## A successful send still records exactly one user message

The ordering change must not lose the event on the happy path — the pending-UI
echo in every other open tab rides on it.

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

`${res.statusCode} | recorded=${recorded.length} | ${recorded[0]}`
=> 200 | recorded=1 | water the plants
```

```ts cleanup
await ctx.cleanup();
```

## A duplicate messageId arriving after a *successful* send is still deduped

Releasing the claim on failure must not weaken the guard it exists for.

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

`${again.statusCode} | dedup=${again.body.deduplicated} | recorded=${recorded.length}`
=> 200 | dedup=true | recorded=1
```

```ts cleanup
await ctx.cleanup();
```
