# Workspace pane storage

The workspace is kept per browser tab, API base, and logical conversation. Its
storage parser treats every saved value as untrusted input and always returns a
usable in-memory state plus notices that the UI adapter can report.

```ts setup
import { createEmptyWorkspaceState, type WorkspaceState } from "../../src/frontend/src/components/chat/workspace/workspace-state.js";
import { createWorkspaceBrowserStoreWithStorage, type WorkspaceStorage } from "../../src/frontend/src/components/chat/workspace/workspace-browser-store.js";
import {
  conversationStorageScope,
  importTrustedLegacyWorkspace,
  parseWorkspaceState,
  restoreWorkspaceState,
  serializeWorkspaceState,
  storageUnavailableNotice,
  workspaceStorageKey,
} from "../../src/frontend/src/components/chat/workspace/workspace-storage.js";

function target(path: string) {
  return { path, viewer: null, params: {}, viewState: null };
}

function workspaceWith(path: string): WorkspaceState {
  const state = createEmptyWorkspaceState();
  return {
    ...state,
    tabs: { [path]: { target: target(path), label: `Card ${path}`, pinned: true, lastActiveAt: 12 } },
    panes: {
      left: { paths: [path], activePath: path, display: "cards" },
      right: { paths: [], activePath: null, display: "chat" },
    },
    mobileView: { kind: "card", path },
    lastInteraction: { kind: "card", path },
  };
}

const legacyRaw = JSON.stringify({
  v: 1,
  activePath: "b",
  tabs: [
    { url: "a", label: "A", pinned: true, lastActiveAt: 1 },
    { url: "b?view=markdown", label: "B", pinned: false, lastActiveAt: 2 },
  ],
});
```

## The API base isolates same-origin development worktrees

```ts
conversationStorageScope("/paper-cards/test1/api")
=> paper-cards/test1

workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "session-1" })
=> bbx:workspace-panes:v2:paper-cards/test1:session-1

workspaceStorageKey({ apiBase: "/other-worktree/test1/api", logicalConversationId: "session-1" }) === workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "session-1" })
=> false
```

Production URLs retain their box identity too.

```ts continue
conversationStorageScope("/my-box/api/")
=> my-box
```

## Version 2 round-trips complete targets and pane state

```ts
const original = workspaceWith("notes/card.md");
const restored = parseWorkspaceState(serializeWorkspaceState(original));
restored.source
=> v2

restored.notices.length
=> 0

restored.state.tabs["notes/card.md"]?.target.path
=> notes/card.md

restored.state.tabs["notes/card.md"]?.pinned
=> true
```

An entry whose registry key disagrees with its serialized target is invalid;
the bad payload is not rewritten or cleared by this pure parser.

```ts continue
const mismatched = JSON.parse(serializeWorkspaceState(original));
mismatched.tabs["notes/card.md"].url = "/views/other.md";
const rejected = parseWorkspaceState(JSON.stringify(mismatched));
rejected.source
=> empty

rejected.notices.map((notice) => notice.code).join(",")
=> invalid-v2
```

Malformed JSON and a wrong version likewise fall back to an initial workspace
with a reportable notice rather than throwing.

```ts continue
parseWorkspaceState("{").notices[0]?.code
=> invalid-v2

parseWorkspaceState('{"version":1}').state.version
=> 2
```

## Invariant drift is repaired at restore

A structurally valid snapshot can still point at a closed active card. The
workspace normalizer repairs that reference and the boundary reports that it
did so.

```ts
const drifted = JSON.parse(serializeWorkspaceState(workspaceWith("a")));
drifted.panes.left.activePath = "missing";
const repaired = parseWorkspaceState(JSON.stringify(drifted));
repaired.source
=> v2

repaired.state.panes.left.activePath
=> a

repaired.notices[0]?.code
=> repaired-v2
```

## A proven-local legacy strip imports into the left pane

The caller must establish provenance before passing a legacy value to this
function. The migration keeps the legacy order, selection, pin, and complete
view target; the right pane starts as conversation.

```ts
const legacy = importTrustedLegacyWorkspace(legacyRaw);
legacy.source
=> legacy

legacy.state.panes.left.paths.join(",")
=> a,b

legacy.state.panes.left.activePath
=> b

legacy.state.panes.right.display
=> chat

legacy.state.tabs.a?.pinned
=> true
```

Invalid trusted legacy data is recoverable and reportable.

```ts continue
importTrustedLegacyWorkspace("not-json").notices[0]?.code
=> invalid-legacy
```

## Restore precedence preserves the newest trusted state

A valid v2 snapshot wins over a trusted legacy strip.

```ts
restoreWorkspaceState({
  v2Raw: serializeWorkspaceState(workspaceWith("stored")),
  trustedLegacyRaw: legacyRaw,
}).state.panes.left.activePath
=> stored
```

An old key whose provenance is unknown is not supplied to restoration. The
workspace starts quietly empty; it does not present a migration diagnostic for
state it intentionally ignored.

```ts continue
const empty = restoreWorkspaceState({ v2Raw: null });
empty.source
=> empty

empty.notices.length
=> 0
```

Blocked browser storage also has a notice that does not contain stored data.

```ts continue
storageUnavailableNotice(new Error("denied")).code
=> storage-unavailable

storageUnavailableNotice(new Error("denied")).message.includes("denied")
=> true
```

## The browser store has an injected persistence boundary

The store writes each transition synchronously. Assigning the provisional
workspace to its session changes the writer first and saves the current state
under that identity, so an old-identity write cannot arrive afterward.

```ts
const values = new Map<string, string>();
const storage: WorkspaceStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
};
const store = createWorkspaceBrowserStoreWithStorage({ apiBase: "/paper-cards/test1/api", boxSlug: "test1--paper-cards", storage });
store.select("provisional-17");
store.dispatch({ type: "openCard", target: target("draft"), label: "Draft", at: 1, viewport: "desktop" });
let observedAdoption = "";
const unsubscribe = store.subscribe(() => {
  const pending = store.getAdoption();
  if (pending !== null) observedAdoption = `${store.getIdentity()}:${pending.from}->${pending.to}`;
});
store.adopt("session-42");
unsubscribe();
store.getIdentity()
=> session-42

observedAdoption
=> session-42:provisional-17->session-42

const assignedKey = workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "session-42" });
parseWorkspaceState(values.get(assignedKey) ?? null).state.panes.left.activePath
=> draft

const provisionalKey = workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "provisional-17" });
values.set(provisionalKey, serializeWorkspaceState(workspaceWith("stale-provisional")));
store.dispatch({ type: "openCard", target: target("after-assignment"), label: "After assignment", at: 2, viewport: "desktop" });
parseWorkspaceState(values.get(assignedKey) ?? null).state.tabs["after-assignment"]?.label
=> After assignment

parseWorkspaceState(values.get(assignedKey) ?? null).state.tabs["stale-provisional"]
=> undefined
```

Selecting another conversation persists the old one and loads the selected
snapshot. Selecting it again restores the assigned workspace.

```ts continue
store.select("session-other");
store.get().panes.left.activePath
=> null

store.dispatch({ type: "openCard", target: target("other"), label: "Other", at: 2, viewport: "desktop" });
store.select("session-42");
store.get().panes.left.activePath
=> after-assignment
```

A rejected write leaves the current conversation's in-memory workspace in place
and exposes a notice. A rejected read during selection starts an unseen target
conversation empty; returning to the first identity restores its cached cards.

```ts
let rejectReads = false;
const rejectedStorage: WorkspaceStorage = {
  getItem: () => {
    if (rejectReads) throw new Error("read denied");
    return null;
  },
  setItem: () => { throw new Error("write denied"); },
};
const rejectedStore = createWorkspaceBrowserStoreWithStorage({ apiBase: "/paper-cards/test1/api", boxSlug: "test1--paper-cards", storage: rejectedStorage });
rejectedStore.select("first");
rejectedStore.dispatch({ type: "openCard", target: target("still-here"), label: "Still here", at: 1, viewport: "desktop" });
rejectedStore.get().panes.left.activePath
=> still-here

rejectedStore.getNotice()?.includes("write denied")
=> true

rejectReads = true;
rejectedStore.select("second");
rejectedStore.get().panes.left.activePath
=> null

rejectedStore.getNotice()?.includes("read denied")
=> true

rejectedStore.dispatch({ type: "openCard", target: target("second-only"), label: "Second only", at: 2, viewport: "desktop" });
rejectedStore.select("first");
rejectedStore.get().panes.left.activePath
=> still-here

rejectedStore.get().tabs["second-only"]
=> undefined
```
