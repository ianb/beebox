# Firing a chat schedule into its originating session

`fireChatSchedule` (`src/webapp/routes/chat-schedule-fire.ts`) injects a fired
`<schedule>` reminder back into the session that created it — not whatever chat
was last active. It resolves the target from `schedule.sessionId`, falls back to
the most-active session for a legacy entry that has none, and re-sends into a
brand-new session once when the target's turn errors instantly (the unresumable
pre-v2 case), so a fired schedule's response is never silently lost.

The fake `ChatBackend` records each spawned run's `startOptions.resumeSessionId`,
so a run's resume id is how we assert which session a fire landed in. The
failed-turn signal is the session's `done` event carrying an `is_error` result;
the fake scripts it via `emitResult({ isError: true })`.

```ts setup
import { fireChatSchedule } from "../../../src/webapp/routes/chat-schedule-fire.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { setMostActive } from "../../../src/core/chat/session/history.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { waitForRuns, plainTestPrompt } from "../../helpers/chat-session-spawner-helpers.js";

function makeRegistry(boxRoot: string, backend: ReturnType<typeof createFakeChatBackend>) {
  return new ChatSessionRegistry(boxRoot, {
    backend,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
}

const noopWire = (_s: unknown): void => {};

function makeSchedule(opts: { sessionId?: string }) {
  return {
    id: "sch_test",
    label: "reminder",
    alarm: false,
    announce: null,
    content: "check the thing",
    createdAt: "2026-01-01T00:00:00.000Z",
    firesAt: "2026-01-01T00:00:00.000Z",
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
  };
}
```

## Fires into the originating session, even when another is most-active

Session `B` is most-active, but the schedule was created in session `A`. The
fire resumes `A`, not `B`.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const registry = makeRegistry(box.root, backend);
const eventBus = createEventBus(box.root);
await setMostActive(box.root, "sess-B");

const firePromise = fireChatSchedule(
  { boxRoot: box.root, registry, eventBus, wireSession: noopWire },
  makeSchedule({ sessionId: "sess-A" }),
);
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
backend.runs[0]?.emitResult();
await firePromise;

JSON.stringify({ runs: backend.runs.length, resumed: backend.runs[0]?.startOptions.resumeSessionId })
=> {"runs":1,"resumed":"sess-A"}
```

```ts continue
// The reminder text reached that run.
const sent = backend.runs[0]?.sent ?? [];
JSON.stringify(sent.length > 0)
=> true
```

```ts cleanup
registry.shutdown();
eventBus.close();
```

## Legacy entry without a session id fires into the most-active session

An entry persisted before `sessionId` existed keeps the old behavior: it
resolves the target from the most-active pointer.

```ts
const box2 = await makeTmpBox();
const backend2 = createFakeChatBackend();
const registry2 = makeRegistry(box2.root, backend2);
const eventBus2 = createEventBus(box2.root);
await setMostActive(box2.root, "sess-most-active");

const firePromise2 = fireChatSchedule(
  { boxRoot: box2.root, registry: registry2, eventBus: eventBus2, wireSession: noopWire },
  makeSchedule({}),
);
await waitForRuns(backend2, { count: 1, timeoutMs: 2000 });
backend2.runs[0]?.emitResult();
await firePromise2;

JSON.stringify({ runs: backend2.runs.length, resumed: backend2.runs[0]?.startOptions.resumeSessionId })
=> {"runs":1,"resumed":"sess-most-active"}
```

```ts cleanup
registry2.shutdown();
eventBus2.close();
```

## Target's turn errors → re-sent into a fresh session

When the targeted session's turn ends with `is_error` (the unresumable case),
the reminder is re-sent once into a brand-new session — a second run with no
resume id.

```ts
const box3 = await makeTmpBox();
const backend3 = createFakeChatBackend();
const registry3 = makeRegistry(box3.root, backend3);
const eventBus3 = createEventBus(box3.root);

const firePromise3 = fireChatSchedule(
  { boxRoot: box3.root, registry: registry3, eventBus: eventBus3, wireSession: noopWire },
  makeSchedule({ sessionId: "sess-dead" }),
);
// First run targets the dead session and errors instantly.
await waitForRuns(backend3, { count: 1, timeoutMs: 2000 });
backend3.runs[0]?.emitResult({ isError: true });
// Fallback spawns a second run in a fresh session; complete it successfully.
await waitForRuns(backend3, { count: 2, timeoutMs: 2000 });
backend3.runs[1]?.emitResult();
await firePromise3;

JSON.stringify({
  runs: backend3.runs.length,
  first: backend3.runs[0]?.startOptions.resumeSessionId ?? null,
  second: backend3.runs[1]?.startOptions.resumeSessionId ?? null,
})
=> {"runs":2,"first":"sess-dead","second":null}
```

```ts cleanup
registry3.shutdown();
eventBus3.close();
```
