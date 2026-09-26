# Links from a list open in the other pane

A list is read beside what it leads to (`docs/plans/todos-ui.md`, Track 5).
A card title, a dated-strip card name, or a todo's words in the todo list,
and "N open" on a directory's todo line, open their card through
`useOpenBeside`, which asks `listLinkRoute` where it goes.

```ts setup
import { listLinkRoute } from "../../src/frontend/src/components/chat/workspace/open-beside.js";
import { createEmptyWorkspaceState, paneForPath, reduceWorkspace } from "../../src/frontend/src/components/chat/workspace/workspace-state.js";

const card = (path) => ({ path, viewer: null, params: {}, viewState: null });
```

## The route

On the desktop, the opposite of the pane the list renders in:

```ts
JSON.stringify(listLinkRoute({ workspace: true, mobile: false, pane: "left" }))
=> {"kind":"open","destinationPane":"right"}

JSON.stringify(listLinkRoute({ workspace: true, mobile: false, pane: "right" }))
=> {"kind":"open","destinationPane":"left"}
```

On a phone there is one pane; the workspace's own mobile rule places the
card, so no destination is named:

```ts
JSON.stringify(listLinkRoute({ workspace: true, mobile: true, pane: "left" }))
=> {"kind":"open"}
```

Outside a workspace pane (no workspace, or a surface no pane provides), the
link keeps its plain `href`:

```ts
listLinkRoute({ workspace: true, mobile: false, pane: null }).kind
=> href

listLinkRoute({ workspace: false, mobile: false, pane: null }).kind
=> href
```

## The workspace honours it

The plate is open in the left pane. Opening a card from it with the route's
destination puts the card in the right pane, and the plate stays where it
was; without a destination the reducer would have used the originating pane.

```ts
const plate = "_content/plate.todo-view.card";
const roof = "_content/projects/porch-rebuild/roof.memo.card";
let state = reduceWorkspace(createEmptyWorkspaceState(), {
  type: "openCard", target: card(plate), label: plate, at: 1, viewport: "desktop", destinationPane: "left",
}).state;
const route = listLinkRoute({ workspace: true, mobile: false, pane: paneForPath(state, plate) });
state = reduceWorkspace(state, {
  type: "openCard", target: card(roof), label: roof, at: 2, viewport: "desktop",
  originatingPane: "left", destinationPane: route.kind === "open" ? route.destinationPane : undefined,
}).state;
[paneForPath(state, plate), paneForPath(state, roof)].join(" | ")
=> left | right
```
