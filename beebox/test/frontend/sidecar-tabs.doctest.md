# The sidecar's tab state (`sidecar-tabs.ts`)

`sidecarReducer` owns which documents are open beside chat, which is showing,
and which are pinned. The decisions worth pinning down are the quiet ones:
where a pinned tab lands, which tab an open evicts, and which tab takes over
when the active one closes.

```ts setup
import { sidecarReducer, EMPTY_SIDECAR, MAX_UNPINNED_TABS, type SidecarState } from "../../src/frontend/src/components/chat/sidecar-tabs.js";

/** A `ViewTarget` for a card path, with no viewer or params. */
function target(path: string) {
  return { path, viewer: null, params: {}, viewState: null };
}

/** Open `path` at time `at` (the clock only matters for eviction order). */
function open(state: SidecarState, path: string, at: number): SidecarState {
  return sidecarReducer(state, { type: "open", target: target(path), label: path, at });
}

/** The strip as the person sees it: labels in order, the active one in [brackets]. */
function strip(state: SidecarState): string {
  return state.tabs
    .map((t) => `${t.pinned ? "📌" : ""}${t.target.path === state.activePath ? `[${t.label}]` : t.label}`)
    .join(" ");
}
```

## Opening, re-opening, and selecting

An open appends and activates. Opening a document that is already open
activates its tab instead of adding a second one.

```ts
const two = open(open(EMPTY_SIDECAR, "a", 1), "b", 2);
strip(two)
=> a [b]

strip(open(two, "a", 3))
=> [a] b
```

Re-opening the same path with a different viewer refreshes the tab's target in
place, so `?view=` actually switches rather than colliding with the open tab.

```ts continue
const withViewer = sidecarReducer(two, {
  type: "open",
  target: { path: "a", viewer: "markdown", params: {}, viewState: null },
  label: "a as markdown",
  at: 4,
});
strip(withViewer)
=> [a as markdown] b

withViewer.tabs.length
=> 2
```

## Closing falls back to the neighbour

```ts
const three = open(open(open(EMPTY_SIDECAR, "a", 1), "b", 2), "c", 3);
strip(sidecarReducer(three, { type: "close", path: "c" }))
=> a [b]
```

Closing a tab that is not the active one leaves the active one alone.

```ts continue
strip(sidecarReducer(three, { type: "close", path: "a" }))
=> b [c]

JSON.stringify(sidecarReducer(sidecarReducer(sidecarReducer(three, { type: "close", path: "a" }), { type: "close", path: "b" }), { type: "close", path: "c" }))
=> {"tabs":[],"activePath":null}
```

## A pinned tab sorts first and stays through other opens

```ts
const pinned = sidecarReducer(open(open(EMPTY_SIDECAR, "a", 1), "b", 2), { type: "togglePin", path: "b", at: 5 });
strip(pinned)
=> 📌[b] a

strip(open(open(pinned, "c", 3), "d", 4))
=> 📌b a c [d]
```

Unpinning drops it to the head of the unpinned group rather than back to where
it was opened — the same place a browser leaves an unpinned tab. It stops being
first-class without jumping across the strip.

```ts continue
strip(sidecarReducer(pinned, { type: "togglePin", path: "b", at: 5 }))
=> [b] a
```

## The cap evicts the least-recently-active unpinned tab

`a` was opened first and never returned to, so it is what an over-cap open
drops.

```ts
let state = EMPTY_SIDECAR;
for (let i = 0; i < MAX_UNPINNED_TABS; i++) state = open(state, `t${i}`, i + 1);
state.tabs.length
=> 12

state = open(state, "one-more", 100);
state.tabs.length
=> 12

state.tabs.some((t) => t.target.path === "t0")
=> false

state.tabs.some((t) => t.target.path === "t1")
=> true
```

Selecting a tab makes it recently-active, which takes it out of the firing
line: the next-oldest goes instead.

```ts continue
state = sidecarReducer(state, { type: "select", path: "t1", at: 101 });
state = open(state, "another", 102);
state.tabs.some((t) => t.target.path === "t1")
=> true

state.tabs.some((t) => t.target.path === "t2")
=> false
```

## Pinned tabs are outside the cap, and the active tab is never evicted

Twelve pinned tabs plus twelve unpinned is twenty-four open tabs: pinning is
how the person says "not this one", and the cap only governs the rest.

```ts
let state = EMPTY_SIDECAR;
for (let i = 0; i < 12; i++) {
  state = open(state, `p${i}`, i + 1);
  state = sidecarReducer(state, { type: "togglePin", path: `p${i}`, at: i + 1 });
}
for (let i = 0; i < MAX_UNPINNED_TABS; i++) state = open(state, `u${i}`, 100 + i);
state.tabs.length
=> 24

state = open(state, "one-more", 200);
state.tabs.filter((t) => t.pinned).length
=> 12
```

Unpinning is the other way over the cap: a pinned tab rejoining a full unpinned
group puts the count at thirteen. Two tabs are protected there — the one on
screen, because evicting what the person is reading is worse than a strip one
tab too long, and the tab they just unpinned, which the toggle marks as touched.
The next-oldest goes instead.

```ts continue
const full: SidecarState = {
  tabs: [
    { target: target("kept"), label: "kept", pinned: true, lastActiveAt: 1 },
    ...Array.from({ length: MAX_UNPINNED_TABS }, (_, i) => ({
      target: target(`u${i}`), label: `u${i}`, pinned: false, lastActiveAt: 10 + i,
    })),
  ],
  activePath: "u0",
};
const unpinned = sidecarReducer(full, { type: "togglePin", path: "kept", at: 50 });
unpinned.tabs.some((t) => t.target.path === "u0")
=> true

unpinned.tabs.some((t) => t.target.path === "u1")
=> false

unpinned.tabs.length
=> 12
```

## Restore puts a stored strip back, pinned-first

```ts
const restored = sidecarReducer(EMPTY_SIDECAR, {
  type: "restore",
  state: {
    tabs: [
      { target: target("loose"), label: "loose", pinned: false, lastActiveAt: 1 },
      { target: target("kept"), label: "kept", pinned: true, lastActiveAt: 2 },
    ],
    activePath: "loose",
  },
});
strip(restored)
=> 📌kept [loose]
```

## Closing the panel clears everything, pinned included

Pinning survives other opens, not an explicit "close this panel" — the close
button means what it says.

```ts continue
JSON.stringify(sidecarReducer(restored, { type: "closeAll" }))
=> {"tabs":[],"activePath":null}
```
