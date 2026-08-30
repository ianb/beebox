# `POST /api/chat/send` — the claim is only as good as the record

A `messageId` carries two claims, and they answer different questions. The
**durable** claim (`.beebox/message-dedup.json`) is written at the same
moment as the persisted user message, so `deduplicated: true` means "the box
really has this message." The **volatile** claim lives only inside the running
request — it stops a double-submit, but it proves nothing: if that request dies
before its durable write, nothing was recorded.

So a duplicate arriving while the first request is still in flight is never
answered `deduplicated: true`. It waits for that request's real outcome and
answers with it, the way the frontend's receipt expectations share one outcome
for one id (`src/frontend/src/lib/receipts.ts`).

That window is now hard to be in at all: since Track A the route claims,
records and responds without an await between them, so a duplicate reaches the
claim registry after the durable write, not during it. The shared-outcome path
stays as the guard for the day an await returns; it is pinned directly on the
registry below.

```ts setup
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { createInFlightSends } from "../../src/webapp/routes/chat-send-dedup.js";
import type { ChatBackend } from "../../src/services/claude-chat-types.js";
import { createEventBus, type BusEvent } from "../../src/core/event-bus.js";
import { createServer } from "../../src/webapp/server.js";
import { ChatSession } from "../../src/core/chat/session/index.js";

/**
 * Hold every `ChatSession.send()` open at its first instruction — the window in
 * which a request has claimed its id but recorded nothing. `entered` resolves
 * once a request is parked there, so a test can fire its duplicate knowing the
 * first request cannot advance until `release()`.
 */
interface SendGate {
  entered: Promise<void>;
  release: () => void;
  restore: () => void;
}

function openSendGate(): SendGate {
  const original = ChatSession.prototype.send;
  let markEntered = (): void => {};
  const entered = new Promise<void>((resolve) => { markEntered = () => resolve(); });
  let letGo = (): void => {};
  const held = new Promise<void>((resolve) => { letGo = () => resolve(); });
  ChatSession.prototype.send = async function patched(message: Parameters<typeof original>[0]) {
    markEntered();
    await held;
    return original.call(this, message);
  };
  return {
    entered,
    release: () => letGo(),
    restore: () => { ChatSession.prototype.send = original; },
  };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** What survived to disk, or "(no file)" when nothing was ever persisted. */
async function readDedupState(boxRoot: string): Promise<string> {
  try {
    return await readFile(join(boxRoot, ".beebox", "message-dedup.json"), "utf-8");
  } catch (_e) {
    return "(no file)";
  }
}

interface RestartedBox {
  server: FastifyInstance;
  /** `chat-user-message` payloads this instance recorded. */
  recorded: string[];
  post: (payload: unknown) => Promise<{ statusCode: number; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}

/**
 * A second server over the SAME box directory: a process restart. Nothing but
 * the box's own files crosses over — in particular the in-memory claims of the
 * previous instance are gone, which is exactly what a crash leaves behind.
 */
async function restartOver(boxRoot: string, chatBackend: ChatBackend): Promise<RestartedBox> {
  const eventBus = createEventBus(boxRoot, { pollInterval: 1000 });
  const server = await createServer({
    boxes: [{ slug: TEST_SLUG, boxRoot, eventBus }],
    openAccess: true,
    chatBackend,
  });
  const recorded: string[] = [];
  eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
  });
  return {
    server,
    recorded,
    async post(payload: unknown) {
      const res = await server.inject({ method: "POST", url: `/${TEST_SLUG}/api/chat/send`, payload });
      return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
    },
    async close() {
      await server.close();
      eventBus.close();
    },
  };
}
```

## A duplicate is answered from the durable claim, because the record beats it

Nothing between taking the volatile claim and answering the request is
awaited: the route records the message and responds in one synchronous span,
and only *then* starts the run (`docs/implemented-plans/emission-model.md`, Track A). So a
duplicate — even one fired the instant the first request enters
`chatSession.send()`, which is what the gate below arranges — arrives after the
durable write and is answered `deduplicated: true`: the strongest answer, and a
true one.

Before Track A the same gate parked the first request for the whole engine
spawn, and this section asserted the two clients sharing one `{turnId}`.

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const gate = openSendGate();
const send = () => ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "feed the cat", messageId: "dup-1" },
});

const first = send();
await gate.entered;
const second = send();
await delay(50);
gate.release();
const [a, b] = await Promise.all([first, second]);

`${a.statusCode} | ${b.statusCode} | turn=${typeof a.body.turnId} | second=${JSON.stringify(b.body)} | recorded=${recorded.length}`
=> 200 | 200 | turn=string | second={"deduplicated":true} | recorded=1
```

```ts cleanup
gate.restore();
await ctx.cleanup();
```

## The shared-outcome path still holds the line if that window ever reopens

The volatile claim is no longer reachable from a duplicate POST — that is the
point of the reorder — so its behavior is pinned at the registry it lives in.
A duplicate that finds a request in flight waits for that request's *real*
outcome; it is never told `deduplicated: true`, because a request that has
recorded nothing yet may still die.

```ts
const sends = createInFlightSends();
const settle = sends.begin("in-flight-1");
const waiting = sends.pending("in-flight-1");
settle({ status: 200, body: { turnId: "t-1" } });

`${JSON.stringify(await waiting)} | afterSettle=${sends.pending("in-flight-1")}`
=> {"status":200,"body":{"turnId":"t-1"}} | afterSettle=null
```

## A send whose run fails to start is still accepted, for the duplicate too

This section used to assert a shared **500**, and a freed id: the route awaited
`chatSession.send()`, so a run that failed to start could still be reported as
the HTTP outcome, and the id had to be released for the retry that invitation
implied.

It no longer can. The route records the message and answers `{turnId}` before
the run starts (`docs/implemented-plans/emission-model.md`, Track A), so by the time a spawn
fails both clients have been told — truthfully — that the box has the message.
The duplicate and the later retry are both answered `deduplicated: true`: the id
stays claimed, because a redelivery must not append the message twice. The
failure reaches the client on the turn stream it is already subscribed to —
covered by `chat-send-run-start-failure.doctest.md`.

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

backend.failNextStart = new Error("spawn EBADF");
const gate = openSendGate();
const send = () => ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "water the plants", messageId: "dup-2" },
});

const first = send();
await gate.entered;
const second = send();
await delay(50);
gate.release();
const [a, b] = await Promise.all([first, second]);
gate.restore();

const retry = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "water the plants", messageId: "dup-2" },
});

`${a.statusCode} | turn=${typeof a.body.turnId} | second=${JSON.stringify(b.body)} | retry=${retry.statusCode} | dedup=${retry.body.deduplicated} | recorded=${recorded.length}`
=> 200 | turn=string | second={"deduplicated":true} | retry=200 | dedup=true | recorded=1
```

```ts cleanup
await ctx.cleanup();
```

## The claim and the record cross the restart together

Nothing awaits between taking the volatile claim and `recordUserMessage()` —
the claim, the persisted message event and the durable write are one
synchronous span on both the busy and the idle path — so a crash can no longer
land between them. That window used to be the whole engine spawn: the claim was
persisted minutes before the message it stood for, and a crash inside it turned
the client's retry into a false "already sent."

What a restart can still see is a message whose run failed to start. Here the
record and the claim are both on disk, so the retry is answered
`deduplicated: true` by a process that never saw the original request — the
right answer, because history really does have the message. (Its *delivery* was
lost with the failed run; that is what the turn stream's error frame tells the
client, and what Track A's failure-mode work covers.)

```ts
const backend = createFakeChatBackend();
backend.failNextStart = new Error("spawn EBADF");
const crashed = await makeTestServer({ chatBackend: backend });
```

```ts continue
const failed = await crashed.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "buy milk", messageId: "restart-1" },
});
const persisted = await readDedupState(crashed.boxRoot);

await crashed.server.close();
const restarted = await restartOver(crashed.boxRoot, createFakeChatBackend());
const retry = await restarted.post({ session: "new", message: "buy milk", messageId: "restart-1" });

`${failed.statusCode} | turn=${typeof failed.body.turnId} | persisted=${persisted.includes("restart-1")} | retry=${retry.statusCode} | dedup=${retry.body.deduplicated} | recorded=${restarted.recorded.length}`
=> 200 | turn=string | persisted=true | retry=200 | dedup=true | recorded=0
```

```ts cleanup
await restarted.close();
await crashed.cleanup();
```

## A durable claim survives the restart

The other side of the same coin: once the message is recorded, the claim is on
disk beside it, and the retry is answered `deduplicated: true` by a process
that never saw the original request.

```ts
const ctx = await makeTestServer({ chatBackend: createFakeChatBackend() });

const sent = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "buy milk", messageId: "restart-2" },
});
const persisted = await readDedupState(ctx.boxRoot);

await ctx.server.close();
const restarted = await restartOver(ctx.boxRoot, createFakeChatBackend());
const retry = await restarted.post({ session: "new", message: "buy milk", messageId: "restart-2" });

`${sent.statusCode} | persisted=${persisted.includes("restart-2")} | retry=${retry.statusCode} | dedup=${retry.body.deduplicated} | recorded=${restarted.recorded.length}`
=> 200 | persisted=true | retry=200 | dedup=true | recorded=0
```

```ts cleanup
await restarted.close();
await ctx.cleanup();
```
