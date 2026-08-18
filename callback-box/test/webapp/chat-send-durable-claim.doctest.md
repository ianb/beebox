# `POST /api/chat/send` — the claim is only as good as the record

A `messageId` carries two claims, and they answer different questions. The
**durable** claim (`.callback-box/message-dedup.json`) is written at the same
moment as the persisted user message, so `deduplicated: true` means "the box
really has this message." The **volatile** claim lives only inside the running
request — it stops a double-submit, but it proves nothing: if that request dies
before its durable write, nothing was recorded.

So a duplicate arriving while the first request is still in flight is never
answered `deduplicated: true`. It waits for that request's real outcome and
answers with it, the way the frontend's receipt expectations share one outcome
for one id (`src/frontend/src/lib/receipts.ts`).

```ts setup
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
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
    return await readFile(join(boxRoot, ".callback-box", "message-dedup.json"), "utf-8");
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

## A duplicate arriving in flight gets the first request's real outcome

Both clients are told the same true thing — one turn, one recorded message —
rather than the second being told the send was already handled by a request
that had not yet handled anything.

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
// The first request is parked, so this wait can only be spent by the second —
// it reaches the claim and parks on the shared outcome.
await delay(50);
gate.release();
const [a, b] = await Promise.all([first, second]);

`${a.statusCode} | ${b.statusCode} | identical=${JSON.stringify(a.body) === JSON.stringify(b.body)} | turn=${typeof a.body.turnId} | recorded=${recorded.length}`
=> 200 | 200 | identical=true | turn=string | recorded=1
```

```ts cleanup
gate.restore();
await ctx.cleanup();
```

## A failing send hands the failure to the duplicate too

The first request releases its volatile claim on the way out, so the duplicate
mirrors the 500 instead of hearing a success — and the id is free for the retry
both clients are now being invited to make.

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

`${a.statusCode} | ${b.statusCode} | identical=${JSON.stringify(a.body) === JSON.stringify(b.body)} | retry=${retry.statusCode} | recorded=${recorded.length}`
=> 500 | 500 | identical=true | retry=200 | recorded=1
```

```ts cleanup
await ctx.cleanup();
```

## Nothing durable survives a request that never recorded anything

A request that dies before the durable point — here, one whose run fails to
start — leaves the box exactly as it found it: no dedup file, no message. The
restart over the same box directory is the crash; the retry that follows runs
the message, exactly once. This is what the reorder buys: the claim used to be
persisted minutes before the message it stood for, so a crash in that window
turned the client's retry into a false "already sent."

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

`${failed.statusCode} | persisted=${persisted} | retry=${retry.statusCode} | turn=${typeof retry.body.turnId} | recorded=${restarted.recorded.length}`
=> 500 | persisted=(no file) | retry=200 | turn=string | recorded=1
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
