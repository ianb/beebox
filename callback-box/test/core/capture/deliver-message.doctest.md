# Capture delivery

`deliverCaptureMessage` injects the `<capture>` wrapper into a chat session,
resolving the target (staging `targetSessionId` → most-active → a fresh session,
never a 404) and enqueuing when the agent is busy. A fake chat backend stands in
for the Claude subprocess so we can inspect what was sent.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat.js";
import { plainTestPrompt, tick } from "../../helpers/chat-session-spawner-helpers.js";
import { appendHistory, setMostActive } from "../../../src/core/chat/session/history.js";
import { deliverCaptureMessage, buildCaptureWrapper, resolveCaptureDeliveryTarget } from "../../../src/core/capture/deliver.js";

const W = buildCaptureWrapper({ docPath: "tmp-capture/x.capture-session.card", imageCount: 1, audioSeconds: 7, summary: "hi" });

function makeRegistry(box, backend) {
  return new ChatSessionRegistry(box.root, {
    backend,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
}

// All text pushed to the backend across a run's sends.
function sentText(run) {
  return run.sent.flat().map((b) => b.text ?? "").join("\n");
}
```

## No live/most-active session → a fresh session is created and sent to

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
const eventBus = createEventBus(box.root);

const res = await deliverCaptureMessage({
  boxRoot: box.root, registry, eventBus, target: { sessionId: null, contextDir: null }, message: W,
});
await tick();

res.queued
=> false

sentText(backend.lastRun()).includes(W)
=> true
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```

## Target chat is busy → the message is enqueued, not sent

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
const eventBus = createEventBus(box.root);

// A live, busy most-active session.
const busy = registry.getOrCreate("s-busy");
await busy.send("first turn");
await tick();
await setMostActive(box.root, "s-busy");

// The caller resolves the target (→ the busy most-active session) first.
const target = await resolveCaptureDeliveryTarget({ boxRoot: box.root, targetSessionId: null });
const res = await deliverCaptureMessage({
  boxRoot: box.root, registry, eventBus, target, message: W,
});

res.queued
=> true
```

The wrapper did not reach the backend — only the in-flight turn's message did:

```ts continue
backend.lastRun().sent.length
=> 1
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```

## Explicit targetSessionId (known to the box) → delivered to it

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
const eventBus = createEventBus(box.root);

await appendHistory(box.root, { sessionId: "s-target" });

const res = await deliverCaptureMessage({
  boxRoot: box.root, registry, eventBus, target: { sessionId: "s-target", contextDir: null }, message: W,
});
await tick();

res.sessionId
=> s-target

sentText(backend.lastRun()).includes(W)
=> true
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```

## A failed (non-busy) send throws CaptureDeliveryError

```ts
const box = await makeTmpBox();
const eventBus = createEventBus(box.root);

const session = { isBusy: () => false, enqueue: () => {}, send: async () => false, getSessionId: () => "s-x" };
const registry = {
  getOrCreate: () => session, createNew: () => session, get: () => session,
  enforceLiveCap: () => {}, touch: () => {}, markMostActive: async () => {},
};

const caught = await deliverCaptureMessage({ boxRoot: box.root, registry, eventBus, target: { sessionId: null, contextDir: null }, message: W }).then(() => "no throw", (e) => e.name);
caught
=> CaptureDeliveryError
```

```ts cleanup
eventBus.close();
await box.cleanup();
```
