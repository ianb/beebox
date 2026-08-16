# Chat session URL transitions

`ChatPage` keeps a fresh chat machine mounted when that same chat receives its
server id. A user navigation from the fresh shell to an existing session may
have the same `new` → id URL shape, but it must remount and load that session's
history. The assignment announcement is what distinguishes the two cases.

```ts setup
import { carriesFreshChatMachine, createSessionAssignmentLatch } from "../../src/frontend/src/pages/chat-session-transition.js";
```

A matching backend assignment carries the in-progress fresh chat:

```ts
carriesFreshChatMachine({
  previousSessionInput: "new",
  nextSessionInput: "assigned-123",
  announcedAssignment: "assigned-123",
})
=> true
```

Explicit landmark navigation to an existing session has no assignment
announcement, so it remounts rather than displaying the blank fresh machine:

```ts
carriesFreshChatMachine({
  previousSessionInput: "new",
  nextSessionInput: "existing-456",
  announcedAssignment: null,
})
=> false
```

A stale or different assignment cannot authorize carrying another session:

```ts
carriesFreshChatMachine({
  previousSessionInput: "new",
  nextSessionInput: "existing-456",
  announcedAssignment: "assigned-123",
})
=> false
```

Ordinary existing-session switches always remount:

```ts
carriesFreshChatMachine({
  previousSessionInput: "existing-123",
  nextSessionInput: "existing-456",
  announcedAssignment: "existing-456",
})
=> false
```

## The assignment latch

The announcement travels through `createSessionAssignmentLatch`, an external
store read via `useSyncExternalStore` — NOT React state. The URL rewrite that
follows an announcement re-renders `ChatPage` through the router store at sync
priority, before a same-tick `setState` would apply; when the announcement was
state, that render still saw `null`, classified the assignment as explicit
navigation, and remounted the machine — dropping the optimistic first message
until the turn became durable
(`issues/bugs/2026-08-08-new-chat-first-message-blank-until-agent-works.md`).
A store snapshot is read live during every render, so an announcement made
immediately before `navigate()` is visible to the navigation's own render:

```ts
const latch = createSessionAssignmentLatch();
const seen: Array<string | null> = [];
const unsubscribe = latch.subscribe(() => seen.push(latch.get()));
latch.get()
=> null

latch.announce("assigned-123");
latch.get()
=> assigned-123

carriesFreshChatMachine({
  previousSessionInput: "new",
  nextSessionInput: "assigned-123",
  announcedAssignment: latch.get(),
})
=> true
```

Clearing consumes the announcement and notifies subscribers; a clear on an
already-empty latch is a no-op (no spurious re-render):

```ts continue
latch.clear();
latch.clear();
JSON.stringify(seen)
=> ["assigned-123",null]

unsubscribe();
latch.announce("after-unsubscribe");
JSON.stringify(seen)
=> ["assigned-123",null]
```
