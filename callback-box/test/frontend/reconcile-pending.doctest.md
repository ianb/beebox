# reconcilePending

`reconcilePending` decides which optimistic ("pending") user messages
should still be displayed after a fresh server-history fetch arrives.
A pending entry is dropped when the server has caught up to it; the
rest stay so the UI keeps showing them dimmed as "queued — waiting".

```ts setup
import { reconcilePending } from "../../src/frontend/src/machines/chat-shared.js";
import type { SessionEntry } from "../../src/frontend/src/api.js";

function userEntry(uuid: string, text: string): SessionEntry {
  return {
    uuid,
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text }],
  };
}
```

## Empty pending → server messages pass through

```ts
const server = [userEntry("s1", "hello")];
const result = reconcilePending({ serverMessages: server, pendingMessages: [] });
print(`messages: ${result.messages.length}`);
print(`pending: ${result.pendingMessages.length}`);
=>
messages: 1
pending: 0
```

## Pending message that the server has caught up to → dropped

```ts
const server = [userEntry("s1", "<typed>hi there</typed>")];
const pending = [userEntry("p1", "<typed>hi there</typed>")];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`pending: ${result.pendingMessages.length}`);
=>
messages: 1
pending: 0
```

## Pending message not yet on the server → re-appended, kept pending

```ts
const server = [userEntry("s1", "<typed>old</typed>")];
const pending = [userEntry("p1", "<typed>new</typed>")];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`last message uuid: ${result.messages[result.messages.length - 1]?.uuid}`);
print(`pending: ${result.pendingMessages.length}`);
=>
messages: 2
last message uuid: p1
pending: 1
```

## Server-injected user attribution → reconcile MUST still drop the pending entry

When the server stores a user message, it calls `injectUserAttr` to
add `user="Name" user-email="addr"` into the opening `<typed>` tag.
The optimistic copy doesn't have those attrs yet. Reconcile must
treat the two as the same message — otherwise the pending bubble
sticks around forever after the queued turn completes.

This is the regression behind the "Agent is busy — your message is
queued" indicator that never clears.

```ts
const server = [userEntry(
  "s1",
  '<typed user="Ian" user-email="ian@example.com" local-time="9:00 AM">hello world</typed>',
)];
const pending = [userEntry(
  "p1",
  '<typed local-time="9:00 AM">hello world</typed>',
)];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`pending (0 expected): ${result.pendingMessages.length}`);
=>
messages: 1
pending (0 expected): 0
```

## Two queued duplicates of one message → both drop after server has the merged turn

The backend's `drainQueue` joins multiple queued texts with `\n\n` into
a single send. So if the user typed the same message twice while busy,
the resulting server entry contains the text twice. Both pending
entries should drop.

```ts
const server = [userEntry(
  "s1",
  '<typed local-time="9:00 AM">say hi</typed>\n\n<typed local-time="9:00 AM">say hi</typed>',
)];
const pending = [
  userEntry("p1", '<typed local-time="9:00 AM">say hi</typed>'),
  userEntry("p2", '<typed local-time="9:00 AM">say hi</typed>'),
];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`pending (0 expected): ${result.pendingMessages.length}`);
=>
pending (0 expected): 0
```
