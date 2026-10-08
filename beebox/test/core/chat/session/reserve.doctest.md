# Coined chat ids: reserving a chat before it exists

A new chat has no identity until the harness assigns one part-way through its
first run, so a capture and a typed message racing to start the same chat can
each create one. A **reservation** closes that window: the client coins a UUID,
the box accepts it, and the harness is told to start the conversation under
exactly that id.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
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

/** A tmp box with a fake backend and a registry; `cleanup()` shuts both down. */
async function makeChat(opts) {
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = new ChatSessionRegistry(box.root, {
    backend,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
    ...(opts ?? {}),
  });
  return {
    box, backend, registry,
    cleanup: async () => { registry.shutdown(); await box.cleanup(); },
    reserve: (fields) => registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {}, ...fields }),
    // Send the first message and wait for the fire-and-forget bookkeeping.
    firstRun: async () => {
      await registry.getOrCreate(COINED).send("hello");
      await tick();
      await waitForSessionRecorded(box, COINED);
    },
  };
}

const HOURS_7 = 7 * 60 * 60 * 1000;
```

## A coined id is accepted, and reserving it again is the same reservation

Idempotence is the whole reason the client mints and the box accepts, rather
than the box coining and the client adopting: a retried request or a StrictMode
double-invoke must land on one chat. The second call did not re-point the chat
at a different landmark:

```ts
const chat = await makeChat();

const first = await chat.reserve({});
const again = await chat.reserve({ contextDir: "_content/recipes" });
[first, again]
=> [{ kind: "reserved", sessionId: "11111111-2222-4333-8444-555555555555" }, { kind: "reserved", sessionId: "11111111-2222-4333-8444-555555555555" }]

chat.registry.getReservation(COINED).contextDir
=> null
```

```ts continue cleanup
await chat.cleanup();
```

## An id that already names a chat is refused, and a non-UUID never reserves

```ts
const chat = await makeChat();
await appendHistory(chat.box.root, { sessionId: OTHER });

const taken = await chat.reserve({ sessionId: OTHER });
const malformed = await chat.reserve({ sessionId: "not-a-uuid" });
[taken.kind, malformed.kind]
=> ["taken", "taken"]
```

```ts continue cleanup
await chat.cleanup();
```

## The harness is told to *use* the coined id, not to resume it

The distinction is load-bearing: a coined id names a conversation with no
transcript, and the harness rejects `--resume` for one it never wrote. The
subprocess also learns its id up front, so a mid-turn `bbx chat screenshot`
resolves without waiting for the post-spawn session-id file:

```ts
const chat = await makeChat();
await chat.reserve({});

await chat.registry.getOrCreate(COINED).send("hello");
await tick();

const opts = chat.backend.lastRun().startOptions;
({ coined: opts.coinedSessionId, resume: opts.resumeSessionId ?? null })
=> { coined: "11111111-2222-4333-8444-555555555555", resume: null }

[opts.env.BBX_CHAT_SESSION_ID, opts.env.BBX_CHAT_SESSION_ID_FILE ?? null]
=> ["11111111-2222-4333-8444-555555555555", null]
```

```ts continue cleanup
await chat.cleanup();
```

## The first run records the chat, because assignment never will

A coined session already knows its id, so `captureAssignedSessionId` returns
early and `onSessionIdAssigned` never fires. The history entry, the most-active
pointer, and the husk card come from the first run start instead. The history
row records the reservation's engine (`appendHistory` would otherwise fall back
to whatever the box is configured with at first-run time, which need not be what
created the transcript) and its landmark and feature seeds.

```ts
const chat = await makeChat();
await chat.reserve({ contextDir: "_content/recipes", seedFeatures: { narration: "on" } });
await chat.firstRun();

(await loadHistoryEntries(chat.box.root)).map((e) => ({ id: e.id, features: e.features ?? null, engine: e.engine, contextDir: e.contextDir }))
=> [{ id: "11111111-2222-4333-8444-555555555555", features: { narration: "on" }, engine: "claude", contextDir: "_content/recipes" }]

await getMostActive(chat.box.root)
=> 11111111-2222-4333-8444-555555555555
```

The handoff from reservation to history loses nothing: the reservation is
released only after the first run's history row is written. Releasing first
left a window — and, since that bookkeeping is deliberately quiet on failure, a
permanent state — in which the chat was bound to a landmark and nothing could
say which. Once the chat is real, the reservation has nothing left to answer for:

```ts continue
[chat.registry.getReservation(COINED), chat.registry.reservationForDirectory("_content/recipes")]
=> [null, null]
```

```ts continue cleanup
await chat.cleanup();
```

## A reservation outlives the swept session entry

The registry drops idle entries after ten minutes. A chat the user opened, left,
and came back to with photos must still be addressable — sweeping stops the
subprocess, it does not cancel the reservation. The re-created session is still
coined, so its first message creates the conversation under the same id rather
than trying to resume a chat that was never written:

```ts
let clock = 1_000;
const chat = await makeChat({ now: () => clock, idleTimeoutMs: 60_000 });
await chat.reserve({});
chat.registry.getOrCreate(COINED);

clock += 120_000;
chat.registry.sweepIdle();

chat.registry.isKnownSession(COINED)
=> true

chat.registry.getReservation(COINED).sessionId
=> 11111111-2222-4333-8444-555555555555
```

```ts continue cleanup
await chat.cleanup();
```

## An unused reservation expires

An expired reservation is no longer a known session and is not somewhere you can
go back to by landmark:

```ts
let clock = 1_000;
const chat = await makeChat({ now: () => clock });
await chat.reserve({ contextDir: "_content/recipes" });

clock += HOURS_7;

[chat.registry.isKnownSession(COINED), chat.registry.reservationForDirectory("_content/recipes")]
=> [false, null]
```

```ts continue cleanup
await chat.cleanup();
```

## An expired reservation releases the subprocess warmed for it

A warm slot is warmed for one chat and can serve no other, so a chat nobody
starts must not keep holding one of the very few slots.

```ts
let clock = 1_000;
const chat = await makeChat({ now: () => clock });
await chat.reserve({});

clock += HOURS_7;
chat.registry.sweepIdle();

chat.backend.closedWarmFor.join(",")
=> 11111111-2222-4333-8444-555555555555
```

```ts continue cleanup
await chat.cleanup();
```

## A reservation answers "which chat is this landmark's?"

`getLastSessionForDirectory` reads the history file, which has no row for a
coined chat until its first turn commits. Without the reservation as a
fallback, leaving a fresh landmark chat and switching back to that landmark
coins a *second* one, every time — the switch never returns you to the chat you
just left.

```ts
const chat = await makeChat();
await chat.reserve({ contextDir: "_content/recipes" });

({
  here: chat.registry.reservationForDirectory("_content/recipes"),
  elsewhere: chat.registry.reservationForDirectory("_content/courses"),
})
=> { here: "11111111-2222-4333-8444-555555555555", elsewhere: null }
```

The box root is a landmark like any other, and `""` is its real binding — kept
distinct from `null`, which means a chat opened from nowhere. Collapsing the two
left a chat opened from the Box row unlabelled until its first turn.

```ts continue
await chat.reserve({ sessionId: OTHER, contextDir: "" });

({
  root: chat.registry.reservationForDirectory(""),
  unbound: chat.registry.getReservation(COINED).contextDir,
})
=> { root: "99999999-8888-4777-8666-555555555555", unbound: "_content/recipes" }
```

```ts continue cleanup
await chat.cleanup();
```
