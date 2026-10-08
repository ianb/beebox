# The app bar's place stack

Pages publish their place to the app bar (`app-bar-chrome.tsx`). The chat
publishes its place, and a focused Browse card publishes its directory over
it. The bar used to hold one place: when Browse closed, its cleanup cleared
the slot, the chat's effect did not run again, and the pill fell back to
"Chat" with no folder menu until a reload. The places now stack, so a cleared
owner gives the place back to the owner below it.

```ts setup
import { dropPlace, pushPlace, topPlace } from "../../src/lib/place-stack.js";

const chat = {};
const browse = {};
const chatPlace = { dir: "inventory", label: "Inventory" };
const browsePlace = { dir: "inventory/shelves", label: "Browse: inventory/shelves" };
const withBrowse = pushPlace(pushPlace([], { owner: chat, place: chatPlace }), { owner: browse, place: browsePlace });
```

Browse publishes over the chat. Clearing Browse shows the chat's place again.

```ts
topPlace(withBrowse)
=> { dir: "inventory/shelves", label: "Browse: inventory/shelves" }

topPlace(dropPlace(withBrowse, browse))
=> { dir: "inventory", label: "Inventory" }
```

A republication updates the owner's entry where it stands. The chat
republishes when its landmark label arrives, which can happen while Browse is
focused; moving the chat to the top then made the pill name the chat while
Browse still had focus. Browse stays on top, and clearing Browse shows the
chat's updated place.

```ts
const republished = pushPlace(withBrowse, { owner: chat, place: { dir: "garden", label: "Garden" } });
topPlace(republished)
=> { dir: "inventory/shelves", label: "Browse: inventory/shelves" }

topPlace(dropPlace(republished, browse))
=> { dir: "garden", label: "Garden" }
```

Clearing an owner that published nothing changes nothing, and an empty stack
shows no place (the bar falls back to its route label).

```ts
dropPlace(withBrowse, {}).map((e) => e.place.dir)
=> ["inventory", "inventory/shelves"]

topPlace(dropPlace(dropPlace(withBrowse, browse), chat))
=> null
```
