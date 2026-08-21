# Coined chat ids: reserving a chat before it exists

A new chat has no identity until the harness assigns one part-way through its
first run, so a capture and a typed message racing to start the same chat can
each create one. A **reservation** closes that window: the client coins a UUID,
the box accepts it, and the harness is told to start the conversation under
exactly that id.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat.js";
import { plainTestPrompt, tick } from "../../../helpers/chat-session-spawner-helpers.js";
import { appendHistory, loadHistoryEntries, getMostActive } from "../../../../src/core/chat/session/history.js";

/**
 * Poll until the fire-and-forget first-run bookkeeping lands. The most-active
 * pointer is written last of the three, so waiting on it means history and the
 * feature seeds are already durable.
 */
async function waitForSessionRecorded(box, sessionId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await getMostActive(box.root) === sessionId) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`session ${sessionId} was never recorded`);
}

const COINED = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

function makeRegistry(box, backend, opts) {
  return new ChatSessionRegistry(box.root, {
    backend,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
    ...(opts ?? {}),
  });
}
```

## A coined id is accepted, and reserving it again is the same reservation

Idempotence is the whole reason the client mints and the box accepts, rather
than the box coining and the client adopting: a retried request or a StrictMode
double-invoke must land on one chat.

```ts
const box = await makeTmpBox();
const registry = makeRegistry(box, createFakeChatBackend());

const first = await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });
const again = await registry.reserve({ sessionId: COINED, contextDir: "store/recipes", seedFeatures: {} });

JSON.stringify([first, again])
=> [{"kind":"reserved","sessionId":"11111111-2222-4333-8444-555555555555"},{"kind":"reserved","sessionId":"11111111-2222-4333-8444-555555555555"}]
```

The second call did not re-point the chat at a different landmark:

```ts continue
registry.getReservation(COINED).contextDir
=> null
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## An id that already names a chat is refused, and a non-UUID never reserves

```ts
const box = await makeTmpBox();
const registry = makeRegistry(box, createFakeChatBackend());
await appendHistory(box.root, { sessionId: OTHER });

const taken = await registry.reserve({ sessionId: OTHER, contextDir: null, seedFeatures: {} });
const malformed = await registry.reserve({ sessionId: "not-a-uuid", contextDir: null, seedFeatures: {} });

JSON.stringify([taken.kind, malformed.kind])
=> ["taken","taken"]
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## The harness is told to *use* the coined id, not to resume it

The distinction is load-bearing: a coined id names a conversation with no
transcript, and the harness rejects `--resume` for one it never wrote.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });

const session = registry.getOrCreate(COINED);
await session.send("hello");
await tick();

const opts = backend.lastRun().startOptions;
JSON.stringify({ coined: opts.coinedSessionId, resume: opts.resumeSessionId ?? null })
=> {"coined":"11111111-2222-4333-8444-555555555555","resume":null}
```

The subprocess also learns its id up front, so a mid-turn `cb chat screenshot`
resolves without waiting for the post-spawn session-id file:

```ts continue
opts.env.CB_CHAT_SESSION_ID
=> 11111111-2222-4333-8444-555555555555

opts.env.CB_CHAT_SESSION_ID_FILE ?? null
=> null
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## The first run records the chat, because assignment never will

A coined session already knows its id, so `captureAssignedSessionId` returns
early and `onSessionIdAssigned` never fires. The history entry, the most-active
pointer, and the husk card come from the first run start instead.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: { narration: "on" } });

const session = registry.getOrCreate(COINED);
await session.send("hello");
await tick();

await waitForSessionRecorded(box, COINED);
const entries = await loadHistoryEntries(box.root);
JSON.stringify(entries.map((e) => ({ id: e.id, features: e.features ?? null })))
=> [{"id":"11111111-2222-4333-8444-555555555555","features":{"narration":"on"}}]

await getMostActive(box.root)
=> 11111111-2222-4333-8444-555555555555
```

Once the chat is real, the reservation has nothing left to answer for:

```ts continue
registry.getReservation(COINED)
=> null
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## A reservation outlives the swept session entry

The registry drops idle entries after ten minutes. A chat the user opened, left,
and came back to with photos must still be addressable — sweeping stops the
subprocess, it does not cancel the reservation.

```ts
const box = await makeTmpBox();
let clock = 1_000;
const registry = makeRegistry(box, createFakeChatBackend(), { now: () => clock, idleTimeoutMs: 60_000 });
await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });
registry.getOrCreate(COINED);

clock += 120_000;
registry.sweepIdle();

registry.isKnownSession(COINED)
=> true
```

The re-created session is still coined, so its first message creates the
conversation under the same id rather than trying to resume a chat that was
never written:

```ts continue
registry.getReservation(COINED).sessionId
=> 11111111-2222-4333-8444-555555555555
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## An unused reservation expires

```ts
const box = await makeTmpBox();
let clock = 1_000;
const registry = makeRegistry(box, createFakeChatBackend(), { now: () => clock });
await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });

clock += 7 * 60 * 60 * 1000;

registry.isKnownSession(COINED)
=> false
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## An expired reservation releases the subprocess warmed for it

A warm slot is warmed for one chat and can serve no other, so a chat nobody
starts must not keep holding one of the very few slots.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
let clock = 1_000;
const registry = makeRegistry(box, backend, { now: () => clock });
await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });

clock += 7 * 60 * 60 * 1000;
registry.sweepIdle();

backend.closedWarmFor.join(",")
=> 11111111-2222-4333-8444-555555555555
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## The reservation's engine is what the history entry records

`appendHistory` would otherwise fall back to whatever the box is configured with
at first-run time, which need not be what created the transcript.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box, backend);
await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });

const session = registry.getOrCreate(COINED);
await session.send("hello");
await tick();
await waitForSessionRecorded(box, COINED);

JSON.stringify((await loadHistoryEntries(box.root)).map((e) => e.engine))
=> ["claude"]
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```
