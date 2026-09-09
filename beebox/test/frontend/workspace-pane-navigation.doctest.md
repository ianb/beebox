# Workspace history navigation decisions

History snapshots restore only for the active development scope and logical
conversation. Without one, a card URL is a fresh open intent.

```ts setup
import {
  decideWorkspaceNavigation,
  parseScopedWorkspaceHistory,
  shouldRestoreMobileWithBack,
  workspaceDisplayReady,
  workspaceRouteBound,
  workspaceOpenShouldReplace,
} from "../../src/frontend/src/components/chat/workspace/workspace-history.js";
import { createEmptyWorkspaceState, reduceWorkspace } from "../../src/frontend/src/components/chat/workspace/workspace-state.js";
import { serializeWorkspaceState } from "../../src/frontend/src/components/chat/workspace/workspace-storage.js";

const snapshot = serializeWorkspaceState(createEmptyWorkspaceState());
const entry = { scope: "paper-cards/test1", identity: "session-1", snapshot, revision: 8 };
```

## Workspace effects wait for the route's authoritative conversation

During first load the rendered conversation may still belong to the previous
URL. An absent or mismatched route selection cannot write that workspace over
the incoming conversation. Both a resolved start and assigned session bind by
their actual identity.

```ts
workspaceRouteBound(undefined, "new-client")
=> false

workspaceRouteBound({ kind: "ready", target: { kind: "session", sessionId: "old-session", contextDir: "" }, label: "Old" }, "new-client")
=> false

workspaceRouteBound({ kind: "ready", target: { kind: "start", clientConversationId: "new-client", contextDir: "", engine: "claude" }, label: "New" }, "new-client")
=> true

workspaceRouteBound({ kind: "ready", target: { kind: "session", sessionId: "session-1", contextDir: "" }, label: "Current" }, "session-1")
=> true

workspaceRouteBound({ kind: "resolving", requestId: "request-1", contextDir: "" }, "session-1")
=> false
```

Assignment keeps the workspace visible through exactly the announced identity
handoff. A store identity from any unrelated conversation remains hidden.

```ts
workspaceDisplayReady({ renderedIdentity: "client-1", storedIdentity: "client-1", adoption: null })
=> true

const adoption = { from: "client-1", to: "session-1" };
workspaceDisplayReady({ renderedIdentity: "client-1", storedIdentity: "session-1", adoption })
=> true

workspaceDisplayReady({ renderedIdentity: "session-1", storedIdentity: "client-1", adoption })
=> true

workspaceDisplayReady({ renderedIdentity: "session-1", storedIdentity: "session-1", adoption })
=> true

workspaceDisplayReady({ renderedIdentity: "other-client", storedIdentity: "session-1", adoption })
=> false

workspaceDisplayReady({ renderedIdentity: "client-1", storedIdentity: "other-session", adoption })
=> false
```

## An unchanged foreground open replaces history

Reducer bookkeeping such as activation time does not create a new Back stop.
Changing an explicit viewer remains a new visible target and pushes.

```ts
const target = (viewer = null) => ({ path: "a", viewer, params: {}, viewState: null });
const first = reduceWorkspace(createEmptyWorkspaceState(), {
  type: "openCard", target: target(), label: "a", at: 1, viewport: "desktop",
}).state;
const reopened = reduceWorkspace(first, {
  type: "openCard", target: target(), label: "renamed a", at: 2, viewport: "desktop",
}).state;
workspaceOpenShouldReplace({ before: first, after: reopened, viewport: "desktop" })
=> true

const changedViewer = reduceWorkspace(first, {
  type: "openCard", target: target("markdown"), label: "a markdown", at: 3, viewport: "desktop",
}).state;
workspaceOpenShouldReplace({ before: first, after: changedViewer, viewport: "desktop" })
=> false

const secondCard = reduceWorkspace(first, {
  type: "openCard", target: { ...target(), path: "b" }, label: "b", at: 4, viewport: "desktop",
}).state;
workspaceOpenShouldReplace({ before: first, after: secondCard, viewport: "desktop" })
=> false
```

## Scope, identity, and snapshot shape are all boundaries

```ts
parseScopedWorkspaceHistory(entry, { scope: "paper-cards/test1", identity: "session-1" }).kind
=> snapshot

parseScopedWorkspaceHistory(entry, { scope: "main/test1", identity: "session-1" }).kind
=> none

parseScopedWorkspaceHistory(entry, { scope: "paper-cards/test1", identity: "session-2" }).kind
=> none

parseScopedWorkspaceHistory({ ...entry, revision: "8" }, { scope: entry.scope, identity: entry.identity }).kind
=> none

parseScopedWorkspaceHistory({ ...entry, snapshot: "not json" }, { scope: entry.scope, identity: entry.identity }).kind
=> none

parseScopedWorkspaceHistory({ ...entry, returnRevision: 7 }, { scope: entry.scope, identity: entry.identity }).kind
=> none
```

## Restored history takes precedence over its projected card URL

The URL on a restored entry reflects the snapshot; replaying it as an open
would run opposite-pane routing a second time.

```ts
decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "a.card" }).kind
=> restore-snapshot

JSON.stringify(decideWorkspaceNavigation({ history: undefined, scope: entry.scope, identity: entry.identity, freshCard: "a.card" }))
=> {"kind":"open-url","card":"a.card"}

decideWorkspaceNavigation({ history: undefined, scope: entry.scope, identity: entry.identity, freshCard: null }).kind
=> keep-current
```

## Mobile Back requires the exact adjacent return entry

The show-conversation push records both the card entry's history index and its
workspace revision. A stale entry matching only one coordinate restores cards
in place instead of navigating somewhere unrelated.

```ts
const returnEntry = { ...entry, revision: 9, returnRevision: 8, returnIndex: 12 };
shouldRestoreMobileWithBack(returnEntry, 13)
=> true

shouldRestoreMobileWithBack({ ...returnEntry, returnIndex: 11 }, 13)
=> false

shouldRestoreMobileWithBack({ ...returnEntry, returnRevision: 7 }, 13)
=> false

shouldRestoreMobileWithBack(returnEntry, 14)
=> false

shouldRestoreMobileWithBack(entry, 13)
=> false
```
