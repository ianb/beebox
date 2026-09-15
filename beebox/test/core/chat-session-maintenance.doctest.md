# A persistent SDK run retains admission across turns

```ts setup
import { once } from "node:events";
import { ChatSession } from "../../src/core/chat/session/index.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { acquireBoxWork, closeBoxMaintenance } from "../../src/lib/box-maintenance.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { waitForRuns } from "../helpers/chat-session-spawner-helpers.js";
```

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true, systemPrompt: async () => "test" });
await session.send("first");
const run = backend.lastRun();
const done = once(session, "done");
run.emitResult();
await done;
await session.send("second");
const maintenance = await closeBoxMaintenance(box.root, { reason: "fixture", drainMs: 1000 });
// This is the permit baked into the subprocess at spawn, after the first send's lease ended.
const tool = await acquireBoxWork(box.root, run.startOptions.env.BBX_BOX_WORK);
await tool.release();
run.sent.length
=> 2

session.enqueue("third queued before closure");
const secondDone = once(session, "done");
run.emitResult();
await secondDone;
session.pauseForMaintenance();
await maintenance.drain();
await maintenance.beginChanges();
run.sent.length
=> 2

await maintenance.complete();
session.resumeAfterMaintenance();
await waitForRuns(backend, { count: 2, timeoutMs: 3000 });
backend.lastRun().sent[0].some((block) => block.type === "text" && block.text.includes("third queued before closure"))
=> true
```

```ts cleanup
session.stop();
await maintenance.release();
await box.cleanup();
```
