// # Remembering the sidecar's open documents (`sidecar-tabs-storage.ts`)
//
// The strip is written to `sessionStorage` and read back on the next render of
// the same browser tab. By then it is untrusted input — a previous bundle wrote
// it, or someone edited it — so it is parsed rather than trusted, and one bad
// entry is dropped on its own instead of taking the strip with it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import { serializeSidecarState, parseSidecarState, sidecarTabsKey, selectSidecarSession, persistSidecarTransition, loadSidecarState, saveSidecarState } from "../../../../src/components/chat/workspace/sidecar-tabs-storage.js";

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

// ## The key is per box and per conversation
//
// Two conversations in two browser tabs must not fight over one slot, and a chat
// that has not been assigned a session id yet is keyed by the placeholder the
// route carries.
void test("Two conversations in two browser tabs must not fight over one slot, and a cha...", async (t) => {
  t.check(sidecarTabsKey({ boxSlug: "test1", sessionInput: "abc123" }), "bbx:sidecar-tabs:test1:abc123");

  t.check(sidecarTabsKey({ boxSlug: "test1", sessionInput: "new" }), "bbx:sidecar-tabs:test1:new");

  t.check(sidecarTabsKey({ boxSlug: undefined, sessionInput: "new" }), "bbx:sidecar-tabs:default:new");
});

// ## A strip survives the round trip, pins and all
//
// The target is stored as the same `view:` string the `?card=` param carries —
// one serialization of a `ViewTarget`, not two.
void test("The target is stored as the same view: string the ?card= param carries — one...", async (t) => {
  const back = parseSidecarState(serializeSidecarState(strip))!;
  t.check(back, strip);

  // A viewer and its params ride along, so a reload does not silently switch which
  // lens a document was open in.

  const withViewer = serializeSidecarState({
    tabs: [{ target: { path: "_content/Data.card", viewer: "sheet", params: { tab: "2" }, viewState: null }, label: "Data", pinned: false, lastActiveAt: 1 }],
    activePath: "_content/Data.card",
  });
  const parsed = parseSidecarState(withViewer)!;
  t.check(parsed, {
    tabs: [{ target: { path: "_content/Data.card", viewer: "sheet", params: { tab: "2" }, viewState: null }, label: "Data", pinned: false, lastActiveAt: 1 }],
    activePath: "_content/Data.card",
  });
});

// ## Nothing stored, or nothing usable, is not an error
void test("Nothing stored, or nothing usable, is not an error", async (t) => {
  t.check(parseSidecarState(null), null);

  t.check(parseSidecarState(""), null);

  t.check(parseSidecarState("{not json"), null);

  t.check(parseSidecarState(JSON.stringify({ v: 1, tabs: [], activePath: null })), null);

  t.check(parseSidecarState(JSON.stringify({ v: 1, activePath: "x" })), null);
});

// ## One bad entry is dropped, not the whole strip
//
// An entry with no url, or a url that parses to no path, is the case a hand-edit
// or an older bundle produces. Its neighbours are still worth restoring.
void test("An entry with no url, or a url that parses to no path, is the case a hand-edi...", async (t) => {
  const mixed = parseSidecarState(JSON.stringify({
    v: 1,
    activePath: "_content/Good.card",
    tabs: [
      { label: "no url", pinned: false, lastActiveAt: 1 },
      { url: "", label: "empty url", pinned: false, lastActiveAt: 2 },
      { url: "_content/Good.card", label: "Good", pinned: false, lastActiveAt: 3 },
    ],
  }))!;
  t.check(mixed, {
    tabs: [{ target: target("_content/Good.card"), label: "Good", pinned: false, lastActiveAt: 3 }],
    activePath: "_content/Good.card",
  });

  // A missing label falls back to the path, and a missing or nonsense `pinned` /
  // `lastActiveAt` takes the quiet default rather than rejecting the tab.

  const sparse = parseSidecarState(JSON.stringify({
    v: 1,
    activePath: null,
    tabs: [{ url: "_content/Sparse.card" }],
  }))!;
  t.check(sparse, {
    tabs: [{ target: target("_content/Sparse.card"), label: "_content/Sparse.card", pinned: false, lastActiveAt: 0 }],
    activePath: "_content/Sparse.card",
  });
});

// ## The same path twice collapses to one tab
//
// One tab per path is an invariant the reducer and the React keys both rely on.
// A double-written or hand-edited store must not be able to produce two tabs that
// act as one.
void test("One tab per path is an invariant the reducer and the React keys both rely on.", async (t) => {
  const duped = parseSidecarState(JSON.stringify({
    v: 1,
    activePath: "_content/Twice.card",
    tabs: [
      { url: "_content/Twice.card", label: "first", pinned: false, lastActiveAt: 1 },
      { url: "_content/Twice.card", label: "second", pinned: true, lastActiveAt: 2 },
    ],
  }))!;
  t.check(duped, {
    tabs: [{ target: target("_content/Twice.card"), label: "second", pinned: true, lastActiveAt: 2 }],
    activePath: "_content/Twice.card",
  });
});

// ## An active path naming a tab that did not survive falls back
//
// Otherwise the pane would restore a strip and render nothing in it.
void test("Otherwise the pane would restore a strip and render nothing in it.", async (t) => {
  const orphaned = parseSidecarState(JSON.stringify({
    v: 1,
    activePath: "_content/Gone.card",
    tabs: [{ url: "_content/Here.card", label: "Here", pinned: false, lastActiveAt: 1 }],
  }))!;
  t.check(orphaned, {
    tabs: [{ target: target("_content/Here.card"), label: "Here", pinned: false, lastActiveAt: 1 }],
    activePath: "_content/Here.card",
  });
});

// ## Explicit conversation changes restore; assignment only renames
void test("Explicit conversation changes restore; assignment only renames", async (t) => {
  t.teardown(async () => {
    try {
      if (previousStorage === undefined) Reflect.deleteProperty(globalThis, "sessionStorage");
      else Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    } catch (error) {
      t.error(error);
    }
  });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const kitchen = { storageKey: "kitchen", logicalKey: "kitchen", panel: strip };
  const gardenStrip = { ...strip, activePath: "_content/Kept.card" };
  saveSidecarState("garden", gardenStrip);
  const garden = selectSidecarSession(kitchen, { storageKey: "garden", logicalKey: "garden" });
  persistSidecarTransition(kitchen, garden);
  const returned = selectSidecarSession(garden, kitchen);
  t.check({ garden: garden.panel, kitchen: returned.panel, kitchenStored: loadSidecarState("kitchen") }, {
    garden: gardenStrip,
    kitchen: strip,
    kitchenStored: strip,
  });

  const provisional = { storageKey: "start-one", logicalKey: "logical-one", panel: strip };
  const assigned = selectSidecarSession(provisional, { storageKey: "assigned-one", logicalKey: "logical-one" });
  persistSidecarTransition(provisional, assigned);
  t.check(assigned.panel, is(strip));
  t.check({ panel: assigned.panel, oldStored: loadSidecarState("start-one"), newStored: loadSidecarState("assigned-one") }, {
    panel: strip,
    oldStored: null,
    newStored: strip,
  });
});
