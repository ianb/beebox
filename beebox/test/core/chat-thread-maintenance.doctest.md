# Thread SDK admission survives multiple turns

```ts setup
import { ChatSessionPool } from "../../src/core/chat/session/pool.js";
import { ChatThreadSession, chatThreadsAreIdle, quiesceChatThreads } from "../../src/core/chat/session/thread.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { acquireBoxWork, closeBoxMaintenance } from "../../src/lib/box-maintenance.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { waitForRuns } from "../helpers/chat-session-spawner-helpers.js";
```

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatThreadSession({ boxRoot: box.root, threadRef: "chats/test.chat.card", chatDescription: "test", backend });
const first = session.send("first");
await waitForRuns(backend, { count: 1, timeoutMs: 3000 });
const run = backend.lastRun();
run.emitResult();
await first;
const second = session.send("second");
const deadline = Date.now() + 3000;
while (run.sent.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
run.sent.length
=> 2

const maintenance = await closeBoxMaintenance(box.root, { reason: "fixture", drainMs: 1000 });
const tool = await acquireBoxWork(box.root, run.startOptions.env.BBX_BOX_WORK);
await tool.release();
chatThreadsAreIdle(box.root)
=> false

quiesceChatThreads(box.root);
run.closed
=> false

run.emitResult();
await second;
await session.send("new work").catch((error) => error.name)
=> BoxMaintenanceError

quiesceChatThreads(box.root);
await maintenance.drain();
await maintenance.beginChanges();
run.closed
=> true
```

```ts cleanup
await maintenance.complete();
await maintenance.release();
session.stop();
await box.cleanup();
```

A thread-pool request already waiting behind an active turn cannot extend that
turn's old permission. Its durable session record survives the refusal.

```ts
const queuedBox = await makeTmpBox({ git: true });
const queuedBackend = createFakeChatBackend();
const pool = new ChatSessionPool(queuedBox.root, { backend: queuedBackend });
const input = { threadRef: "chats/test.chat.card", chatDescription: "test", message: "first" };
const initial = pool.send(input);
await waitForRuns(queuedBackend, { count: 1, timeoutMs: 3000 });
const activeRun = queuedBackend.lastRun();
activeRun.emitSessionInit("11111111-2222-4333-8444-555555555555");
const queued = pool.send({ ...input, message: "waiting" }).catch((error) => error.name);
await new Promise((resolve) => setImmediate(resolve));
const closed = await closeBoxMaintenance(queuedBox.root, { reason: "fixture", drainMs: 1000 });
activeRun.emitResult();
await initial;
await queued
=> BoxMaintenanceError

activeRun.sent.length
=> 1

quiesceChatThreads(queuedBox.root);
await closed.drain();
JSON.parse(await queuedBox.read(".beebox/chat-thread-sessions.json"))[input.threadRef].messageCount
=> 1
```

```ts cleanup
await closed.complete();
await closed.release();
pool.stop();
await queuedBox.cleanup();
```
