# Chat history dropdown: the landmark you're in comes first

`layoutSessionList` decides what the history dropdown renders. The rule is
**prominence, not scoping**: the chats bound to the landmark you're chatting in
lead under its name, and everything else follows under "Other chats". Nothing is
filtered out — a chat in another landmark is always still reachable.

```ts setup
import { layoutSessionList } from "../../src/frontend/src/components/chat/session-list-grouping.js";

function session(sessionId: string, contextDir: string, landmarkLabel: string) {
  return {
    sessionId,
    source: "chat",
    label: `chat ${sessionId}`,
    lastUsedAt: "2026-07-30T12:00:00Z",
    isActive: false,
    contextDir,
    landmarkLabel,
  };
}

const SESSIONS = [
  session("r1", "store/recipes", "Recipes"),
  session("n1", "store/notes", "Notes"),
  session("r2", "store/recipes", "Recipes"),
  session("root1", "", "Root"),
];

// Compact rendering of a layout, so the expectations read like the menu does.
function show(layout) {
  if (layout.kind === "flat") {
    return `flat${layout.showLandmark ? " (tagged)" : ""}: ${layout.sessions.map((s) => s.sessionId).join(" ")}`;
  }
  return [
    `${layout.hereLabel}: ${layout.here.map((s) => s.sessionId).join(" ")}`,
    `Other chats: ${layout.elsewhere.map((s) => s.sessionId).join(" ")}`,
  ].join("\n");
}
```

## Chatting inside a landmark

Its chats lead, under the landmark's own name. Everything else — including the
root chats — stays below, in the order it came in (most recent first).

```ts
show(layoutSessionList({ sessions: SESSIONS, contextDir: "store/recipes" }))
=>
Recipes: r1 r2
Other chats: n1 root1
```

Root is not a special case — it's a landmark like any other, so a root-bound
chat promotes root's chats and pushes the rest down.

```ts
show(layoutSessionList({ sessions: SESSIONS, contextDir: "" }))
=>
Root: root1
Other chats: r1 n1 r2
```

## When grouping would say nothing, it doesn't group

A landmark with no chats of its own yet gets no empty heading — one flat list,
tagged with each row's landmark since they differ.

```ts
show(layoutSessionList({ sessions: SESSIONS, contextDir: "store/empty" }))
=> flat (tagged): r1 n1 r2 root1
```

Same for a brand-new chat whose binding hasn't resolved yet (`contextDir` is
null until the session id lands).

```ts
show(layoutSessionList({ sessions: SESSIONS, contextDir: null }))
=> flat (tagged): r1 n1 r2 root1
```

And when every chat is in the landmark you're in, a lone "Recipes" heading over
the whole list would be pure chrome — so it stays flat, and the rows carry no
tag because there's only one landmark to name.

```ts
const onlyRecipes = SESSIONS.filter((s) => s.contextDir === "store/recipes");
show(layoutSessionList({ sessions: onlyRecipes, contextDir: "store/recipes" }))
=> flat: r1 r2
```

A box that has never used landmarks lands here too: every chat is root-bound, so
no headings and no "in Root" tag repeated down every row.

```ts
const allRoot = [session("a", "", "Root"), session("b", "", "Root")];
show(layoutSessionList({ sessions: allRoot, contextDir: "" }))
=> flat: a b
```
