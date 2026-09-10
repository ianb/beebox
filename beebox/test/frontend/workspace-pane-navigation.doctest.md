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
  explicitConversationHistoryState,
  revealConversationActions,
  workspaceHistoryTarget,
} from "../../src/frontend/src/components/chat/workspace/workspace-history.js";
import { createEmptyWorkspaceState, projectWorkspace, reduceWorkspace } from "../../src/frontend/src/components/chat/workspace/workspace-state.js";
import { serializeWorkspaceState } from "../../src/frontend/src/components/chat/workspace/workspace-storage.js";

const snapshot = serializeWorkspaceState(createEmptyWorkspaceState());
const entry = { scope: "paper-cards/test1", identity: "session-1", snapshot, revision: 8 };
```

## Explicit chat-about intent reveals the conversation once

The router state preserves unrelated history metadata. The workspace then uses
ordinary pane actions to reveal chat after the selected card has opened.

```ts
JSON.stringify(explicitConversationHistoryState({ inherited: "sentinel", bbxConversation: { kind: "old" } }))
=> {"inherited":"sentinel","bbxWorkspaceRevealConversation":true}

const detailed = { path: "dashboard.card", viewer: "Source", params: { page: "2" }, viewState: { cursor: 4 } };
let focused = reduceWorkspace(createEmptyWorkspaceState(), {
  type: "openCard", target: detailed, label: "Dashboard", at: 1, viewport: "desktop",
}).state;
focused = reduceWorkspace(focused, { type: "focusPane", pane: focused.lastCardPane }).state;
const focusActions = revealConversationActions({ state: focused, cardPath: detailed.path, viewport: "desktop" });
focusActions.map((action) => action.type).join(",")
=> backToSplit

const revealed = focusActions.reduce((state, action) => reduceWorkspace(state, action).state, focused);
projectWorkspace(revealed, "desktop").transcript
=> right

JSON.stringify(revealed.tabs[detailed.path]?.target)
=> {"path":"dashboard.card","viewer":"Source","params":{"page":"2"},"viewState":{"cursor":4}}
```

When both desktop panes contain cards, the selected card stays visible and the
other pane becomes chat. Mobile retains the selected card as the return target.

```ts continue
let twoCards = reduceWorkspace(createEmptyWorkspaceState(), {
  type: "openCard", target: detailed, label: "Dashboard", at: 1, viewport: "desktop",
}).state;
twoCards = reduceWorkspace(twoCards, {
  type: "openCard", target: { ...detailed, path: "notes.card" }, label: "Notes", at: 2, viewport: "desktop",
}).state;
twoCards = reduceWorkspace(twoCards, { type: "moveActive", pane: "left" }).state;
const desktopActions = revealConversationActions({ state: twoCards, cardPath: "notes.card", viewport: "desktop" });
JSON.stringify(desktopActions)
=> [{"type":"showChat","pane":"left","viewport":"desktop"}]

const desktopRevealed = desktopActions.reduce((state, action) => reduceWorkspace(state, action).state, twoCards);
JSON.stringify(projectWorkspace(desktopRevealed, "desktop"))
=> {"visiblePanes":[{"pane":"right","path":"notes.card"}],"visiblePaths":{"right":"notes.card"},"transcript":"left","foregroundPath":"notes.card","restorePane":"left"}

const mobileCard = reduceWorkspace(twoCards, {
  type: "openCard", target: { ...detailed, path: "notes.card" }, label: "Notes", at: 3, viewport: "mobile",
}).state;
const mobileActions = revealConversationActions({ state: mobileCard, cardPath: "notes.card", viewport: "mobile" });
const mobileRevealed = mobileActions.reduce((state, action) => reduceWorkspace(state, action).state, mobileCard);
JSON.stringify(projectWorkspace(mobileRevealed, "mobile"))
=> {"visiblePanes":[],"visiblePaths":{},"transcript":"full","foregroundPath":null,"restorePane":"left"}

JSON.stringify(mobileRevealed.mobileView)
=> {"kind":"chat","returnPath":"notes.card"}

JSON.stringify(workspaceHistoryTarget({ state: mobileRevealed, viewport: "mobile", retainedTarget: { ...detailed, path: "notes.card" } }))
=> {"path":"notes.card","viewer":"Source","params":{"page":"2"},"viewState":{"cursor":4}}
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

JSON.stringify(decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "nested.card?view=Source", cardEntry: true }))
=> {"kind":"open-url","card":"nested.card?view=Source"}

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

## Canonical card entry beats an inherited arrangement

A compatibility redirect can preserve the previous Dashboard snapshot while
its URL asks to open Settings. Only projected chat entries restore snapshots;
a canonical card entry must execute its new open intent. Back to a projected
entry continues restoring the exact arrangement.

```ts
JSON.stringify(decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "_config/interface/settings.card", cardEntry: true }))
=> {"kind":"open-url","card":"_config/interface/settings.card"}

decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "_config/interface/settings.card", cardEntry: false }).kind
=> restore-snapshot
```
