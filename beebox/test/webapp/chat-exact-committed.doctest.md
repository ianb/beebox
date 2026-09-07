# Exact sends wait for committed assignment, not transcript enumeration

A Codex init can arrive before the registry records and promotes its session.
The exact target becomes admissible at promotion even if engine history has not
appeared. Deletion still wins over that live entry.

```ts setup
import { once } from "node:events";
import { ChatSessionRegistry } from "../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { assertExactSessionTarget } from "../../src/webapp/routes/chat-send-target.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { plainTestPrompt } from "../helpers/chat-session-spawner-helpers.js";
```

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = new ChatSessionRegistry(box.root, { backend, buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }) });
const ctx = { boxRoot: box.root, registry };
const session = registry.createNew({ engine: "codex" });
const id = "55555555-5555-4555-8555-555555555555";
let earlyCheck: Promise<string> | undefined;
session.on("message", (message) => {
  if (message.session_id === id && earlyCheck === undefined) {
    earlyCheck = assertExactSessionTarget(ctx, id).then(() => "accepted", (error: Error) => error.name);
  }
});
await session.send("hi");
const committed = once(registry, "session-assigned");
backend.lastRun()?.emitSessionInit(id);
await committed;
await earlyCheck
=> ExactSessionTargetError

await assertExactSessionTarget(ctx, id)
=> undefined

registry.deletion.begin(id);
await assertExactSessionTarget(ctx, id)
=> throws UnavailableChatSessionError

registry.deletion.cancel(id);
await assertExactSessionTarget(ctx, "unknown-id")
=> throws ExactSessionTargetError
```

```ts cleanup
await registry.shutdown();
await box.cleanup();
```
