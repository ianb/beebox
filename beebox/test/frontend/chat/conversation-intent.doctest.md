# Conversation navigation intent

A new card path is attention, not a recipient change. Explicit chat URLs and
restored history entries take precedence. A cold card resolves its landmark;
a cold bare chat retains the existing most-active bootstrap behavior.

```ts setup
import { routeConversationRequest, createResolutionGate } from "../../../src/frontend/src/components/chat/everywhere/conversation-intent.js";
import type { ConversationSelection } from "../../../src/shared/chat-composer-binding.js";
const kitchen: ConversationSelection = { kind: "ready", label: "Kitchen", target: { kind: "session", sessionId: "kitchen-chat", contextDir: "kitchen" } };
const cold: ConversationSelection = { kind: "resolving", requestId: "initial", contextDir: "" };
const base = { first: false, chatPage: false, search: {}, selection: kitchen, remembered: null, cardPath: "/house/pantry.doc.card", browseDir: null };
```

```ts
routeConversationRequest(base)
=> null

routeConversationRequest({ ...base, first: true, selection: cold })?.kind
=> card

routeConversationRequest({ ...base, first: true, selection: cold, cardPath: null, chatPage: true })?.kind
=> default

routeConversationRequest({ ...base, first: true, selection: cold, cardPath: null })?.contextDir
=>

routeConversationRequest({ ...base, chatPage: true, search: { session: "garden-chat" } })?.sessionId
=> garden-chat

const garden: ConversationSelection = { kind: "ready", label: "Garden", target: { kind: "session", sessionId: "garden-chat", contextDir: "garden" } };
routeConversationRequest({ ...base, remembered: garden })?.sessionId
=> garden-chat

const stored: ConversationSelection = { kind: "ready", label: "Study", target: { kind: "session", sessionId: "study-chat", contextDir: "study" } };
routeConversationRequest({ ...base, first: true, selection: cold, remembered: null, stored })
=> {
  "kind": "session",
  "sessionId": "study-chat",
  "contextDir": "study"
}

routeConversationRequest({ ...base, first: true, chatPage: true,
  search: { session: "garden-chat" }, selection: cold, stored })?.sessionId
=> garden-chat

routeConversationRequest({ ...base, first: true, selection: cold,
  remembered: garden, stored })?.sessionId
=> garden-chat
```

The first lookup can finish last without replacing the user's newer intent.
A late completion after the owner unmounts is rejected by the same gate.

```ts
const gate = createResolutionGate();
const kitchenLookup = gate.claim();
const gardenLookup = gate.claim();
gate.accepts(gardenLookup)
=> true

gate.accepts(kitchenLookup)
=> false

gate.cancel();
gate.accepts(gardenLookup)
=> false
```

A matching history entry restores an unassigned startup. A copied explicit
new-chat URL has no such association and remains a request for a new chat.

```ts
const start: ConversationSelection = { kind: "ready", label: "Kitchen", target: { kind: "start", clientConversationId: "pending-kitchen", contextDir: "kitchen", engine: "codex" } };
routeConversationRequest({ ...base, first: true, chatPage: true, search: { session: "new" }, selection: start, remembered: start })
=> null

routeConversationRequest({ ...base, first: true, chatPage: true, search: { session: "new" }, selection: start, remembered: null })?.kind
=> new
```

Workspace card projection changes the URL after the first route evaluation. A
matching remembered startup still owns that route, so projection must not coin
a replacement conversation. Explicit startup changes remain new requests.

```ts continue
routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new" }, selection: start, remembered: start })
=> null

routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new", contextDir: "garden" }, selection: start, remembered: start })?.kind
=> new

routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new", engine: "claude" }, selection: start, remembered: start })?.kind
=> new

routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new", model: "different" }, selection: start, remembered: start })?.kind
=> new
```

A restored existing target is revalidated, and Back can restore the precise
unassigned start without coining a replacement.

```ts
routeConversationRequest({ ...base, first: true })?.sessionId
=> kitchen-chat

const pending: ConversationSelection = { kind: "ready", label: "Pending", target: { kind: "start", clientConversationId: "pending-card", contextDir: "kitchen", engine: "codex" } };
routeConversationRequest({ ...base, remembered: pending })?.target
=> {
  "kind": "start",
  "clientConversationId": "pending-card",
  "contextDir": "kitchen",
  "engine": "codex"
}
```
