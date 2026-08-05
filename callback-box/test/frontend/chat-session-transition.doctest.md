# Chat session URL transitions

`ChatPage` keeps a fresh chat machine mounted when that same chat receives its
server id. A user navigation from the fresh shell to an existing session may
have the same `new` → id URL shape, but it must remount and load that session's
history. The assignment announcement is what distinguishes the two cases.

```ts setup
import { carriesFreshChatMachine } from "../../src/frontend/src/pages/chat-session-transition.js";
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
