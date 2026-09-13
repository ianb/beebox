# Conversation storage belongs to a box instance

Two router worktrees can expose `test1` on the same origin. Visiting one after
the other must not restore a foreign conversation or its ambient observers.
Production keeps its existing keys. Unattributable old development records are
left untouched, rather than guessed into either clone.

```ts setup
import { storageScopeFor } from "../../../src/frontend/src/lib/storage-scope.js";
import { readConversation, saveConversation } from "../../../src/frontend/src/components/chat/everywhere/conversation-state.js";
import { readTrackedSessions, writeTrackedSessions } from "../../../src/frontend/src/components/chat/ambient/tracked-sessions.js";
import { readActiveSessions, writeActiveSessions } from "../../../src/frontend/src/components/chat/ambient/active-sessions.js";
```

```ts
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const values = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
} });
const first = storageScopeFor("/chat-everywhere/test1/api");
const second = storageScopeFor("/paper-cards/test1/api");
const production = storageScopeFor("/test1/api");
saveConversation(production, { kind: "ready", label: "Old selection", target: { kind: "session", sessionId: "old-chat", contextDir: "" } });
saveConversation(first, { kind: "ready", label: "First clone", target: { kind: "session", sessionId: "first-chat", contextDir: "" } });
writeTrackedSessions(first, [{ sessionId: "first-chat", label: "First clone" }]);
writeActiveSessions(first, ["first-chat"]);
readConversation(second)
=> null

readTrackedSessions(second)
=> []

readActiveSessions(second)
=> []

readConversation(first)?.label
=> First clone

JSON.stringify(readTrackedSessions(first).map((session) => session.sessionId))
=> ["first-chat"]

JSON.stringify(readActiveSessions(first))
=> ["first-chat"]

readConversation(production)?.label
=> Old selection

values.has("bbx-conversation:test1")
=> true
```

```ts cleanup
if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
else Reflect.deleteProperty(globalThis, "sessionStorage");
```
