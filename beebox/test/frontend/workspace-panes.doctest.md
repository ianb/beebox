# Workspace pane state

The workspace reducer owns both pane strips atomically. Its projection renders
one conversation even when both stored panes show chat, and mobile has its own
single foreground without rewriting the remembered desktop layout.

```ts setup
import {
  createEmptyWorkspaceState,
  normalizeWorkspaceState,
  projectWorkspace,
  reduceWorkspace,
} from "../../src/frontend/src/components/chat/workspace/workspace-state.js";

const target = (path, viewer = null) => ({ path, viewer, params: {}, viewState: null });
const open = (state, path, at, viewport = "desktop", originatingPane) =>
  reduceWorkspace(state, { type: "openCard", target: target(path), label: path, at, viewport, originatingPane }).state;
const panes = (state) => `${state.panes.left.paths.join(",")}|${state.panes.right.paths.join(",")}`;
```

## The first card opens opposite the chat anchor

Fresh state anchors chat on the right, so a desktop open reveals the card on
the left. Showing conversation there collapses both chat projections into one.

```ts
let state = open(createEmptyWorkspaceState(), "a", 1);
panes(state)
=> a|

JSON.stringify(projectWorkspace(state, "desktop"))
=> {"visiblePanes":[{"pane":"left","path":"a"}],"visiblePaths":{"left":"a"},"transcript":"right","foregroundPath":"a","restorePane":null}

state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
projectWorkspace(state, "desktop").transcript
=> full

projectWorkspace(state, "desktop").visiblePanes.length
=> 0
```

## A fresh open moves an existing hidden tab opposite visible chat

The same path is never duplicated. Here `a` is retained behind left-hand chat;
opening it while chat is left atomically moves it to the right and refreshes
its explicit viewer.

```ts
let state = open(createEmptyWorkspaceState(), "a", 1);
state = open(state, "b", 2, "desktop", "left");
state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
state = reduceWorkspace(state, {
  type: "openCard", target: target("a", "markdown"), label: "a markdown", at: 3,
  viewport: "desktop", originatingPane: "left",
}).state;
panes(state)
=> b|a

[Object.keys(state.tabs).length, state.tabs.a.target.viewer, state.panes.right.activePath].join("|")
=> 2|markdown|a
```

## Two card panes respect origin, move, focus, and the focus ladder

With no visible chat, a new card uses the originating pane. Moving acts on the
active tab, reveals the destination, and leaves a neighbour selected. Leaving
focus returns to split rather than jumping to conversation.

```ts
let state = open(createEmptyWorkspaceState(), "left-a", 1);
state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
state = open(state, "right-a", 2, "desktop", "right");
state = reduceWorkspace(state, { type: "restoreCards", viewport: "desktop", pane: "left" }).state;
state = open(state, "left-b", 3, "desktop", "left");
panes(state)
=> left-a,left-b|right-a

state = reduceWorkspace(state, { type: "moveActive", pane: "left" }).state;
[panes(state), state.panes.left.activePath, state.panes.right.activePath].join("|")
=> left-a|right-a,left-b|left-a|left-b

state = reduceWorkspace(state, { type: "focusPane", pane: "right" }).state;
state.layout.kind
=> focus

state = reduceWorkspace(state, { type: "backToSplit", pane: "right" }).state;
state.layout.kind
=> split
```

## Mobile foreground is independent from desktop layout

Entering mobile chooses the last explicitly interacted-with card. Mobile Show
conversation changes only `mobileView`; returning desktop preserves its split
and pane display flags. Show cards restores a retained selection without a new
opposite-pane open decision.

```ts
let state = open(createEmptyWorkspaceState(), "a", 1);
state = open(state, "b", 2, "desktop", "right");
state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
projectWorkspace(state, "mobile").foregroundPath
=> b

const desktopBefore = JSON.stringify({ layout: state.layout, panes: state.panes });
state = reduceWorkspace(state, { type: "showChat", pane: "right", viewport: "mobile" }).state;
projectWorkspace(state, "mobile").transcript
=> full

JSON.stringify({ layout: state.layout, panes: state.panes }) === desktopBefore
=> true

state = reduceWorkspace(state, { type: "restoreCards", viewport: "mobile" }).state;
projectWorkspace(state, "mobile").foregroundPath
=> b
```

Mobile Show conversation restores the card just put aside, even when the chat
anchor points to the other pane and that pane also retains cards.

```ts
let state = open(createEmptyWorkspaceState(), "left", 1);
state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
state = open(state, "right", 2);
state = reduceWorkspace(state, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
state = reduceWorkspace(state, { type: "selectTab", path: "right", at: 3, viewport: "mobile" }).state;
state = reduceWorkspace(state, { type: "showChat", pane: "right", viewport: "mobile" }).state;
[state.chatAnchor, state.mobileView.returnPath, projectWorkspace(state, "mobile").restorePane].join("|")
=> left|right|right

state = reduceWorkspace(state, { type: "restoreCards", viewport: "mobile" }).state;
projectWorkspace(state, "mobile").foregroundPath
=> right
```

## Desktop foreground follows the last activated visible pane

Both panes remain visible, but attention follows selection rather than always
falling onto the right-hand projection.

```ts
let state = open(createEmptyWorkspaceState(), "left", 1);
state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
state = open(state, "right", 2);
state = reduceWorkspace(state, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
state = reduceWorkspace(state, { type: "selectTab", path: "right", at: 3, viewport: "desktop" }).state;
projectWorkspace(state, "desktop").foregroundPath
=> right

state = reduceWorkspace(state, { type: "selectTab", path: "left", at: 4, viewport: "desktop" }).state;
projectWorkspace(state, "desktop").foregroundPath
=> left
```

## Closing repairs selections, mobile return, and focused empty panes

```ts
let state = open(createEmptyWorkspaceState(), "a", 1);
state = reduceWorkspace(state, { type: "focusPane", pane: "left" }).state;
state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "mobile" }).state;
state = reduceWorkspace(state, { type: "closeTab", path: "a", viewport: "mobile" }).state;
[state.layout.kind, state.mobileView.kind, state.panes.left.activePath].join("|")
=> split|chat|

state.mobileView.returnPath
=> null
```

Closing the active foreground tab in the left pane keeps attention on its left
neighbour even while a second card remains visible on the right.

```ts
let state = open(createEmptyWorkspaceState(), "left-a", 1);
state = open(state, "left-b", 2);
state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
state = open(state, "right", 3);
state = reduceWorkspace(state, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
state = reduceWorkspace(state, { type: "selectTab", path: "left-b", at: 4, viewport: "desktop" }).state;
state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
state = reduceWorkspace(state, { type: "setViewport", viewport: "desktop" }).state;
state = reduceWorkspace(state, { type: "closeTab", path: "left-b", viewport: "desktop" }).state;
[state.panes.left.activePath, projectWorkspace(state, "desktop").foregroundPath].join("|")
=> left-a|left-a
```

## Plain reopen preserves an authored target

A link that names only the path activates the existing tab without erasing its
viewer, params, or authored view state. Those fields change only when the new
open intent explicitly supplies them.

```ts
let state = reduceWorkspace(createEmptyWorkspaceState(), {
  type: "openCard",
  target: { path: "a", viewer: "canvas", params: { mode: "detail" }, viewState: { frame: 4 } },
  label: "authored a", at: 1, viewport: "desktop",
}).state;
state = open(state, "a", 2);
JSON.stringify(state.tabs.a.target)
=> {"path":"a","viewer":"canvas","params":{"mode":"detail"},"viewState":{"frame":4}}
```

## A moved card retargets the existing tab

The move keeps the pane, renderer parameters, pin, and active-card identity. It
does not open a second tab at the destination path.

```ts
let state = reduceWorkspace(createEmptyWorkspaceState(), {
  type: "openCard",
  target: { path: "old", viewer: "canvas", params: { page: "2" }, viewState: null },
  label: "Moved card", at: 1, viewport: "desktop",
}).state;
state = reduceWorkspace(state, {
  type: "retargetCard",
  fromPath: "old",
  target: { ...state.tabs.old.target, path: "archive/new" },
}).state;
JSON.stringify({
  paths: Object.keys(state.tabs),
  pane: state.panes.left,
  target: state.tabs["archive/new"].target,
  interaction: state.lastInteraction,
})
=> {"paths":["archive/new"],"pane":{"paths":["archive/new"],"activePath":"archive/new","display":"cards"},"target":{"path":"archive/new","viewer":"canvas","params":{"page":"2"},"viewState":null},"interaction":{"kind":"card","path":"archive/new"}}
```

## Move and focus are explicit card interactions

```ts
let state = open(createEmptyWorkspaceState(), "a", 1);
state = reduceWorkspace(state, { type: "moveActive", pane: "left" }).state;
JSON.stringify(state.lastInteraction)
=> {"kind":"card","path":"a"}

state = reduceWorkspace(state, { type: "focusPane", pane: "right" }).state;
JSON.stringify(state.lastInteraction)
=> {"kind":"card","path":"a"}
```

## Restore normalizes corrupt ownership instead of fabricating cards

Duplicates keep their first owner, missing registry paths disappear, active
paths fall back to a real tab, empty card displays become chat, and invalid
focus/mobile references are repaired.

```ts
const tab = { target: target("a"), label: "a", pinned: false, lastActiveAt: 1 };
const repaired = normalizeWorkspaceState({
  version: 2,
  tabs: { a: tab },
  panes: {
    left: { paths: ["a", "missing"], activePath: "missing", display: "cards" },
    right: { paths: ["a"], activePath: "a", display: "cards" },
  },
  layout: { kind: "focus", pane: "right" },
  lastCardPane: "right",
  chatAnchor: "right",
  mobileView: { kind: "card", path: "missing" },
  lastInteraction: { kind: "card", path: "missing" },
});
[panes(repaired), repaired.panes.left.activePath, repaired.panes.right.display, repaired.layout.kind].join("|")
=> a||a|chat|split

[repaired.mobileView.kind, repaired.lastInteraction.kind].join("|")
=> card|chat
```

## The unpinned cap is global and protects both pane selections

```ts
let state = createEmptyWorkspaceState();
for (let i = 0; i < 12; i++) state = open(state, `l${i}`, i + 1, "desktop", "left");
state = open(state, "right-active", 20, "desktop", "right");
Object.values(state.tabs).filter((tab) => !tab.pinned).length
=> 12

state.tabs["right-active"] !== undefined
=> true

state.tabs.l11 !== undefined
=> true
```
