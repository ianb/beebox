// # Workspace pane storage
//
// The workspace is kept per browser tab, API base, and logical conversation. Its
// storage parser treats every saved value as untrusted input and always returns a
// usable in-memory state plus notices that the UI adapter can report.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
import { createEmptyWorkspaceState } from "../../../src/components/chat/workspace/state-model.js";
import type { WorkspaceState } from "../../../src/components/chat/workspace/state-types.js";
import { createWorkspaceBrowserStoreWithStorage, type WorkspaceStorage } from "../../../src/components/chat/workspace/WorkspaceProvider/workspace-browser-store.js";
import {
  importTrustedLegacyWorkspace,
  parseWorkspaceState,
  restoreWorkspaceState,
  serializeWorkspaceState,
  storageUnavailableNotice,
  workspaceStorageKey,
} from "../../../src/components/chat/workspace/storage.js";
import { storageScopeFor } from "../../../src/lib/storage-scope.js";

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

const EMPTY_STATE: WorkspaceState = {
  version: 2,
  tabs: {},
  panes: {
    left: { paths: [], activePath: null, display: "chat" },
    right: { paths: [], activePath: null, display: "chat" },
  },
  layout: { kind: "split" },
  lastCardPane: "left",
  chatAnchor: "right",
  mobileView: { kind: "chat", returnPath: null },
  lastInteraction: { kind: "chat" },
};

/** The state after opening these cards in order on desktop; the last one is active. */
function openedCards(cards: { path: string; label: string; at: number }[]): WorkspaceState {
  const last = cards[cards.length - 1];
  if (last === undefined) throw new Error("openedCards needs a card");
  return {
    ...EMPTY_STATE,
    tabs: Object.fromEntries(cards.map((c) => [c.path, { target: target(c.path), label: c.label, pinned: false, lastActiveAt: c.at }])),
    panes: {
      left: { paths: cards.map((c) => c.path), activePath: last.path, display: "cards" },
      right: { paths: [], activePath: null, display: "chat" },
    },
    lastInteraction: { kind: "card", path: last.path },
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

// ## The API base isolates same-origin development worktrees
void test("The API base isolates same-origin development worktrees", async (t) => {
  t.check(storageScopeFor("/paper-cards/test1/api"), "paper-cards/test1");

  t.check(workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "session-1" }), "bbx:workspace-panes:v2:paper-cards/test1:session-1");

  t.check(
    workspaceStorageKey({ apiBase: "/other-worktree/test1/api", logicalConversationId: "session-1" }),
    not(workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "session-1" })),
  );

  // Production URLs retain their box identity too.

  t.check(storageScopeFor("/my-box/api/"), "my-box");
});

// ## Version 2 round-trips complete targets and pane state
void test("Version 2 round-trips complete targets and pane state", async (t) => {
  const original = workspaceWith("notes/card.md");
  const restored = parseWorkspaceState(serializeWorkspaceState(original));
  t.check(restored, { state: original, source: "v2", notices: [] });

  // An entry whose registry key disagrees with its serialized target is invalid;
  // the bad payload is not rewritten or cleared by this pure parser.

  const mismatched = JSON.parse(serializeWorkspaceState(original));
  mismatched.tabs["notes/card.md"].url = "/views/other.md";
  const rejected = parseWorkspaceState(JSON.stringify(mismatched));
  t.check(rejected, {
    state: EMPTY_STATE,
    source: "empty",
    notices: [{ code: "invalid-v2", message: "The saved workspace could not be restored. Your current workspace is still usable." }],
  });

  // Malformed JSON and a wrong version likewise fall back to an initial workspace
  // with a reportable notice rather than throwing.

  const invalidV2: ReturnType<typeof parseWorkspaceState> = {
    state: EMPTY_STATE,
    source: "empty",
    notices: [{ code: "invalid-v2", message: "The saved workspace could not be restored. Your current workspace is still usable." }],
  };
  t.check(parseWorkspaceState("{"), invalidV2);

  t.check(parseWorkspaceState('{"version":1}'), invalidV2);
});

// ## Invariant drift is repaired at restore
//
// A structurally valid snapshot can still point at a closed active card. The
// workspace normalizer repairs that reference and the boundary reports that it
// did so.
void test("A structurally valid snapshot can still point at a closed active card.", async (t) => {
  const drifted = JSON.parse(serializeWorkspaceState(workspaceWith("a")));
  drifted.panes.left.activePath = "missing";
  const repaired = parseWorkspaceState(JSON.stringify(drifted));
  t.check(repaired, {
    state: workspaceWith("a"),
    source: "v2",
    notices: [{ code: "repaired-v2", message: "Some saved workspace entries were repaired while restoring." }],
  });
});

// ## A proven-local legacy strip imports into the left pane
//
// The caller must establish provenance before passing a legacy value to this
// function. The migration keeps the legacy order, selection, pin, and complete
// view target; the right pane starts as conversation.
void test("The caller must establish provenance before passing a legacy value to this fu...", async (t) => {
  const legacy = importTrustedLegacyWorkspace(legacyRaw);
  t.check(legacy, {
    state: {
      ...EMPTY_STATE,
      tabs: {
        a: { target: target("a"), label: "A", pinned: true, lastActiveAt: 1 },
        b: { target: { path: "b", viewer: "markdown", params: {}, viewState: null }, label: "B", pinned: false, lastActiveAt: 2 },
      },
      panes: {
        left: { paths: ["a", "b"], activePath: "b", display: "cards" },
        right: { paths: [], activePath: null, display: "chat" },
      },
      mobileView: { kind: "card", path: "b" },
      lastInteraction: { kind: "card", path: "b" },
    },
    source: "legacy",
    notices: [],
  });

  // Invalid trusted legacy data is recoverable and reportable.

  t.check(importTrustedLegacyWorkspace("not-json"), {
    state: EMPTY_STATE,
    source: "empty",
    notices: [{ code: "invalid-legacy", message: "The saved card tabs could not be restored. Your current workspace is still usable." }],
  });
});

// ## Restore precedence preserves the newest trusted state
//
// A valid v2 snapshot wins over a trusted legacy strip.
void test("A valid v2 snapshot wins over a trusted legacy strip.", async (t) => {
  t.check(
    restoreWorkspaceState({
      v2Raw: serializeWorkspaceState(workspaceWith("stored")),
      trustedLegacyRaw: legacyRaw,
    }),
    { state: workspaceWith("stored"), source: "v2", notices: [] },
  );

  // An old key whose provenance is unknown is not supplied to restoration. The
  // workspace starts quietly empty; it does not present a migration diagnostic for
  // state it intentionally ignored.

  t.check(restoreWorkspaceState({ v2Raw: null }), { state: EMPTY_STATE, source: "empty", notices: [] });

  // Blocked browser storage also has a notice that does not contain stored data.

  t.check(storageUnavailableNotice(new Error("denied")), {
    code: "storage-unavailable",
    message: "Workspace persistence is unavailable (denied). This workspace will remain usable until reload.",
  });
});

// ## The browser store has an injected persistence boundary
//
// The store writes each transition synchronously. Assigning the provisional
// workspace to its session changes the writer first and saves the current state
// under that identity, so an old-identity write cannot arrive afterward.
void test("The store writes each transition synchronously.", async (t) => {
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
  t.check(store.getIdentity(), "session-42");

  t.check(observedAdoption, "session-42:provisional-17->session-42");

  const assignedKey = workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "session-42" });
  t.check(parseWorkspaceState(values.get(assignedKey) ?? null).state, openedCards([{ path: "draft", label: "Draft", at: 1 }]));

  const provisionalKey = workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "provisional-17" });
  values.set(provisionalKey, serializeWorkspaceState(workspaceWith("stale-provisional")));
  store.dispatch({ type: "openCard", target: target("after-assignment"), label: "After assignment", at: 2, viewport: "desktop" });
  // The stale provisional snapshot does not leak into the assigned key.
  t.check(parseWorkspaceState(values.get(assignedKey) ?? null).state, openedCards([
    { path: "draft", label: "Draft", at: 1 },
    { path: "after-assignment", label: "After assignment", at: 2 },
  ]));

  // Selecting another conversation persists the old one and loads the selected
  // snapshot. Selecting it again restores the assigned workspace.

  store.select("session-other");
  t.check(store.get(), EMPTY_STATE);

  store.dispatch({ type: "openCard", target: target("other"), label: "Other", at: 2, viewport: "desktop" });
  store.select("session-42");
  t.check(store.get(), openedCards([
    { path: "draft", label: "Draft", at: 1 },
    { path: "after-assignment", label: "After assignment", at: 2 },
  ]));
});

// A rejected write leaves the current conversation's in-memory workspace in place
// and exposes a notice. A rejected read during selection starts an unseen target
// conversation empty; returning to the first identity restores its cached cards.
void test("A rejected write leaves the current conversation's in-memory workspace in pla...", async (t) => {
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
  const stillHere = openedCards([{ path: "still-here", label: "Still here", at: 1 }]);
  t.check(rejectedStore.get(), stillHere);

  t.check(rejectedStore.getNotice(), "Workspace persistence is unavailable (write denied). This workspace will remain usable until reload.");

  rejectReads = true;
  rejectedStore.select("second");
  t.check(rejectedStore.get(), EMPTY_STATE);

  t.check(rejectedStore.getNotice(), "Workspace persistence is unavailable (read denied). This workspace will remain usable until reload.");

  rejectedStore.dispatch({ type: "openCard", target: target("second-only"), label: "Second only", at: 2, viewport: "desktop" });
  rejectedStore.select("first");
  t.check(rejectedStore.get(), stillHere);
});

// ## Selecting a conversation with nothing saved makes it an arrival candidate
//
// Arrival opens the place only for a conversation this tab has no saved
// arrangement for (docs/implemented-plans/landmark-arrival.md, Track D). `select` sets the
// candidate flag when it finds nothing in memory and nothing in storage.
// `takeArrival` returns the flag once and clears it.
void test("Arrival opens the place only for a conversation this tab has no saved arrange...", async (t) => {
  const arrivalValues = new Map<string, string>();
  const arrivalStorage: WorkspaceStorage = {
    getItem: (key) => arrivalValues.get(key) ?? null,
    setItem: (key, value) => { arrivalValues.set(key, value); },
  };
  const arrivals = createWorkspaceBrowserStoreWithStorage({ apiBase: "/paper-cards/test1/api", boxSlug: "test1--paper-cards", storage: arrivalStorage });
  arrivals.select("fresh-chat");
  t.check(arrivals.hasArrival(), true);

  t.check(arrivals.takeArrival(), true);

  t.check(arrivals.takeArrival(), false);

  // An arrangement in storage is saved state, even one with no cards, so it is not
  // a candidate. Neither is a conversation this store already holds in memory.

  arrivalValues.set(workspaceStorageKey({ apiBase: "/paper-cards/test1/api", logicalConversationId: "closed-everything" }), serializeWorkspaceState(createEmptyWorkspaceState()));
  arrivals.select("closed-everything");
  t.check(arrivals.hasArrival(), false);

  arrivals.select("stored-cards");
  arrivals.select("fresh-chat");
  t.check(arrivals.hasArrival(), false);

  // Any card action by the person ends a pending arrival, and so does
  // `cancelArrival` (a pointer, focus, or key event in the chat pane).

  arrivals.select("dispatched");
  arrivals.dispatch({ type: "openCard", target: target("mine"), label: "Mine", at: 3, viewport: "desktop" });
  t.check(arrivals.takeArrival(), false);

  arrivals.select("typed-first");
  arrivals.cancelArrival();
  t.check(arrivals.takeArrival(), false);

  // Adopting a session id keeps the provisional chat's arrangement, so the adopted
  // identity is not a new arrival.

  arrivals.select("provisional-arrival");
  arrivals.adopt("session-arrival");
  t.check(arrivals.hasArrival(), false);
});
