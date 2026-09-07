# Remembering the sidecar's open documents (`sidecar-tabs-storage.ts`)

The strip is written to `sessionStorage` and read back on the next render of
the same browser tab. By then it is untrusted input — a previous bundle wrote
it, or someone edited it — so it is parsed rather than trusted, and one bad
entry is dropped on its own instead of taking the strip with it.

```ts setup
import { serializeSidecarState, parseSidecarState, sidecarTabsKey, selectSidecarSession, persistSidecarTransition, loadSidecarState, saveSidecarState } from "../../src/frontend/src/components/chat/sidecar-tabs-storage.js";

function target(path: string) {
  return { path, viewer: null, params: {}, viewState: null };
}
const strip = {
  tabs: [
    { target: target("_content/Kept.card"), label: "Kept", pinned: true, lastActiveAt: 10 },
    { target: target("_content/Loose.md"), label: "Loose", pinned: false, lastActiveAt: 20 },
  ],
  activePath: "_content/Loose.md",
};
```

## The key is per box and per conversation

Two conversations in two browser tabs must not fight over one slot, and a chat
that has not been assigned a session id yet is keyed by the placeholder the
route carries.

```ts
sidecarTabsKey({ boxSlug: "test1", sessionInput: "abc123" })
=> bbx:sidecar-tabs:test1:abc123

sidecarTabsKey({ boxSlug: "test1", sessionInput: "new" })
=> bbx:sidecar-tabs:test1:new

sidecarTabsKey({ boxSlug: undefined, sessionInput: "new" })
=> bbx:sidecar-tabs:default:new
```

## A strip survives the round trip, pins and all

The target is stored as the same `view:` string the `?card=` param carries —
one serialization of a `ViewTarget`, not two.

```ts
const back = parseSidecarState(serializeSidecarState(strip))!;
back.tabs.map((t) => `${t.pinned ? "📌" : ""}${t.label}`).join(" ")
=> 📌Kept Loose

back.activePath
=> _content/Loose.md

back.tabs[0]!.target.path
=> _content/Kept.card
```

A viewer and its params ride along, so a reload does not silently switch which
lens a document was open in.

```ts continue
const withViewer = serializeSidecarState({
  tabs: [{ target: { path: "_content/Data.card", viewer: "sheet", params: { tab: "2" }, viewState: null }, label: "Data", pinned: false, lastActiveAt: 1 }],
  activePath: "_content/Data.card",
});
const parsed = parseSidecarState(withViewer)!;
parsed.tabs[0]!.target.viewer
=> sheet

JSON.stringify(parsed.tabs[0]!.target.params)
=> {"tab":"2"}
```

## Nothing stored, or nothing usable, is not an error

```ts
parseSidecarState(null)
=> null

parseSidecarState("")
=> null

parseSidecarState("{not json")
=> null

parseSidecarState(JSON.stringify({ v: 1, tabs: [], activePath: null }))
=> null

parseSidecarState(JSON.stringify({ v: 1, activePath: "x" }))
=> null
```

## One bad entry is dropped, not the whole strip

An entry with no url, or a url that parses to no path, is the case a hand-edit
or an older bundle produces. Its neighbours are still worth restoring.

```ts
const mixed = parseSidecarState(JSON.stringify({
  v: 1,
  activePath: "_content/Good.card",
  tabs: [
    { label: "no url", pinned: false, lastActiveAt: 1 },
    { url: "", label: "empty url", pinned: false, lastActiveAt: 2 },
    { url: "_content/Good.card", label: "Good", pinned: false, lastActiveAt: 3 },
  ],
}))!;
mixed.tabs.length
=> 1

mixed.tabs[0]!.label
=> Good
```

A missing label falls back to the path, and a missing or nonsense `pinned` /
`lastActiveAt` takes the quiet default rather than rejecting the tab.

```ts continue
const sparse = parseSidecarState(JSON.stringify({
  v: 1,
  activePath: null,
  tabs: [{ url: "_content/Sparse.card" }],
}))!;
sparse.tabs[0]!.label
=> _content/Sparse.card

JSON.stringify([sparse.tabs[0]!.pinned, sparse.tabs[0]!.lastActiveAt])
=> [false,0]
```

## The same path twice collapses to one tab

One tab per path is an invariant the reducer and the React keys both rely on.
A double-written or hand-edited store must not be able to produce two tabs that
act as one.

```ts
const duped = parseSidecarState(JSON.stringify({
  v: 1,
  activePath: "_content/Twice.card",
  tabs: [
    { url: "_content/Twice.card", label: "first", pinned: false, lastActiveAt: 1 },
    { url: "_content/Twice.card", label: "second", pinned: true, lastActiveAt: 2 },
  ],
}))!;
duped.tabs.length
=> 1

duped.tabs[0]!.label
=> second
```

## An active path naming a tab that did not survive falls back

Otherwise the pane would restore a strip and render nothing in it.

```ts
const orphaned = parseSidecarState(JSON.stringify({
  v: 1,
  activePath: "_content/Gone.card",
  tabs: [{ url: "_content/Here.card", label: "Here", pinned: false, lastActiveAt: 1 }],
}))!;
orphaned.activePath
=> _content/Here.card
```

## Explicit conversation changes restore; assignment only renames

```ts
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const values = new Map();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
} });
const kitchen = { storageKey: "kitchen", logicalKey: "kitchen", panel: strip };
const gardenStrip = { ...strip, activePath: "_content/Kept.card" };
saveSidecarState("garden", gardenStrip);
const garden = selectSidecarSession(kitchen, { storageKey: "garden", logicalKey: "garden" });
persistSidecarTransition(kitchen, garden);
const returned = selectSidecarSession(garden, kitchen);
JSON.stringify({ garden: garden.panel.activePath, kitchen: returned.panel.activePath, kitchenStillStored: loadSidecarState("kitchen") !== null });
=> {"garden":"_content/Kept.card","kitchen":"_content/Loose.md","kitchenStillStored":true}

const provisional = { storageKey: "start-one", logicalKey: "logical-one", panel: strip };
const assigned = selectSidecarSession(provisional, { storageKey: "assigned-one", logicalKey: "logical-one" });
persistSidecarTransition(provisional, assigned);
JSON.stringify({ samePanel: assigned.panel === strip, oldRemoved: !values.has("start-one"), newStored: values.has("assigned-one") });
=> {"samePanel":true,"oldRemoved":true,"newStored":true}
```

```ts cleanup
if (previousStorage === undefined) delete globalThis.sessionStorage;
else Object.defineProperty(globalThis, "sessionStorage", previousStorage);
```
