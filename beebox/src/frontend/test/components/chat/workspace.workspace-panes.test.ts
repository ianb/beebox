// # Workspace pane state
//
// The workspace reducer owns both pane strips atomically. Its projection renders
// one conversation even when both stored panes show chat, and mobile has its own
// single foreground without rewriting the remembered desktop layout.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  createEmptyWorkspaceState,
  normalizeWorkspaceState,
  projectWorkspace,
} from "../../../src/components/chat/workspace/state-model.js";
import { reduceWorkspace } from "../../../src/components/chat/workspace/state-reducer.js";
import type { PaneId, Viewport, WorkspaceState } from "../../../src/components/chat/workspace/state-types.js";
import type { SidecarTab } from "../../../src/components/chat/sidecar-tabs.js";
import type { ViewTarget } from "../../../src/lib/view-url.js";
import assert from "node:assert/strict";

const target = (path: string, viewer: string | null): ViewTarget => ({ path, viewer, params: {}, viewState: null });

interface OpenSpec {
  path: string;
  at: number;
  viewport?: Viewport;
  originatingPane?: PaneId;
  destinationPane?: PaneId;
}

const open = (state: WorkspaceState, { path, at, viewport, originatingPane, destinationPane }: OpenSpec) =>
  reduceWorkspace(state, { type: "openCard", target: target(path, null), label: path, at, viewport: viewport ?? "desktop", originatingPane, destinationPane }).state;
function tab(state: WorkspaceState, path: string): SidecarTab {
  const found = state.tabs[path];
  assert.ok(found);
  return found;
}
type Pane = WorkspaceState["panes"]["left"];
const cards = (paths: string[], activePath: string): Pane => ({ paths, activePath, display: "cards" });
const CHAT_PANE: Pane = { paths: [], activePath: null, display: "chat" };
type Projection = ReturnType<typeof projectWorkspace>;
const fullChat = (restorePane: PaneId): Projection => ({ visiblePanes: [], visiblePaths: {}, transcript: "full", foregroundPath: null, restorePane });
const cardOnly = (pane: PaneId, path: string): Projection => ({ visiblePanes: [{ pane, path }], visiblePaths: { [pane]: path }, transcript: null, foregroundPath: path, restorePane: null });

// ## The first card opens opposite the chat anchor
//
// Fresh state anchors chat on the right, so a desktop open reveals the card on
// the left. Showing conversation there collapses both chat projections into one.
void test("Fresh state anchors chat on the right, so a desktop open reveals the card on...", async (t) => {
  // doctest:L37
  let state = open(createEmptyWorkspaceState(), { path: "a", at: 1 });
  t.check(state.panes, { left: cards(["a"], "a"), right: CHAT_PANE });

  // doctest:L41
  t.check(projectWorkspace(state, "desktop"), {
    visiblePanes: [
      {
        pane: "left",
        path: "a",
      },
    ],
    visiblePaths: {
      left: "a",
    },
    transcript: "right",
    foregroundPath: "a",
    restorePane: null,
  });

  // doctest:L44
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  t.check(projectWorkspace(state, "desktop"), fullChat("left"));
});

// ## A fresh open moves an existing hidden tab opposite visible chat
//
// The same path is never duplicated. Here `a` is retained behind left-hand chat;
// opening it while chat is left atomically moves it to the right and refreshes
// its explicit viewer.
void test("The same path is never duplicated.", async (t) => {
  // doctest:L59
  let state = open(createEmptyWorkspaceState(), { path: "a", at: 1 });
  state = open(state, { path: "b", at: 2, originatingPane: "left" });
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  state = reduceWorkspace(state, {
    type: "openCard", target: target("a", "markdown"), label: "a markdown", at: 3,
    viewport: "desktop", originatingPane: "left",
  }).state;
  t.check({ panes: state.panes, tabs: state.tabs }, {
    panes: {
      left: { paths: ["b"], activePath: "b", display: "chat" },
      right: cards(["a"], "a"),
    },
    tabs: {
      b: { target: target("b", null), label: "b", pinned: false, lastActiveAt: 2 },
      a: { target: target("a", "markdown"), label: "a markdown", pinned: false, lastActiveAt: 3 },
    },
  });
});

// ## Two card panes respect origin, move, focus, and the focus ladder
//
// With no visible chat, a new card uses the originating pane. Moving acts on the
// active tab, reveals the destination, and leaves a neighbour selected. Leaving
// focus returns to split rather than jumping to conversation.
void test("With no visible chat, a new card uses the originating pane.", async (t) => {
  // doctest:L80
  let state = open(createEmptyWorkspaceState(), { path: "left-a", at: 1 });
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  state = open(state, { path: "right-a", at: 2, originatingPane: "right" });
  state = reduceWorkspace(state, { type: "restoreCards", viewport: "desktop", pane: "left" }).state;
  state = open(state, { path: "left-b", at: 3, originatingPane: "left" });
  t.check(state.panes, { left: cards(["left-a", "left-b"], "left-b"), right: cards(["right-a"], "right-a") });

  // doctest:L88
  state = reduceWorkspace(state, { type: "moveActive", pane: "left" }).state;
  t.check(state.panes, { left: cards(["left-a"], "left-a"), right: cards(["right-a", "left-b"], "left-b") });

  // doctest:L92
  state = reduceWorkspace(state, { type: "focusPane", pane: "right" }).state;
  t.check(state.layout, { kind: "focus", pane: "right" });

  // doctest:L96
  state = reduceWorkspace(state, { type: "backToSplit", pane: "right" }).state;
  t.check(state.layout, { kind: "split" });
});

// ## An explicit desktop destination can reveal a card beside a focused source
//
// Browse uses this hint for files: files go to the right while the retained
// Browse tab stays on the left. Crossing out of a focused left pane restores the
// split; opening from Browse when it already occupies the right adds another tab
// there instead of duplicating or moving Browse. Mobile keeps its single-card
// placement rules.
void test("Browse uses this hint for files:", async (t) => {
  // doctest:L110
  let state = open(createEmptyWorkspaceState(), { path: "browse", at: 1 });
  state = reduceWorkspace(state, { type: "focusPane", pane: "left" }).state;
  state = open(state, { path: "file-a", at: 2, originatingPane: "left", destinationPane: "right" });
  t.check({ panes: state.panes, layout: state.layout }, {
    panes: { left: cards(["browse"], "browse"), right: cards(["file-a"], "file-a") },
    layout: { kind: "split" },
  });

  // doctest:L116
  state = open(state, { path: "browse-right", at: 3, originatingPane: "right" });
  state = open(state, { path: "file-b", at: 4, originatingPane: "right", destinationPane: "right" });
  t.check(state.panes, { left: cards(["browse"], "browse"), right: cards(["file-a", "browse-right", "file-b"], "file-b") });

  // doctest:L121
  const mobile = open(createEmptyWorkspaceState(), { path: "mobile-file", at: 1, viewport: "mobile", destinationPane: "right" });
  t.check(mobile.panes, { left: cards(["mobile-file"], "mobile-file"), right: CHAT_PANE });
});

// An explicit desktop destination also relocates an existing card. Without that
// hint, opening a card retained in the other pane keeps the pre-existing focus
// behavior and moves focus to its owning pane.
void test("An explicit desktop destination also relocates an existing card.", async (t) => {
  // doctest:L131
  let relocation = open(createEmptyWorkspaceState(), { path: "file", at: 1 });
  relocation = open(relocation, { path: "browse", at: 2, originatingPane: "left" });
  relocation = open(relocation, { path: "file", at: 3, originatingPane: "left", destinationPane: "right" });
  t.check(relocation.panes, { left: cards(["browse"], "browse"), right: cards(["file"], "file") });

  // doctest:L137
  let focused = open(createEmptyWorkspaceState(), { path: "left", at: 1 });
  focused = reduceWorkspace(focused, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  focused = open(focused, { path: "right", at: 2 });
  focused = reduceWorkspace(focused, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
  focused = reduceWorkspace(focused, { type: "focusPane", pane: "left" }).state;
  focused = open(focused, { path: "right", at: 3 });
  t.check({ panes: focused.panes, layout: focused.layout }, {
    panes: { left: cards(["left"], "left"), right: cards(["right"], "right") },
    layout: {
      kind: "focus",
      pane: "right",
    },
  });
});

// ## Mobile foreground is independent from desktop layout
//
// Entering mobile chooses the last explicitly interacted-with card. Mobile Show
// conversation changes only `mobileView`; returning desktop preserves its split
// and pane display flags. Show cards restores a retained selection without a new
// opposite-pane open decision.
void test("Entering mobile chooses the last explicitly interacted-with card.", async (t) => {
  // doctest:L155
  let state = open(createEmptyWorkspaceState(), { path: "a", at: 1 });
  state = open(state, { path: "b", at: 2, originatingPane: "right" });
  state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
  t.check(projectWorkspace(state, "mobile"), cardOnly("left", "b"));

  // doctest:L161
  const desktopBefore = structuredClone({ layout: state.layout, panes: state.panes });
  state = reduceWorkspace(state, { type: "showChat", pane: "right", viewport: "mobile" }).state;
  t.check(projectWorkspace(state, "mobile"), fullChat("left"));

  // doctest:L166
  t.check({ layout: state.layout, panes: state.panes }, desktopBefore);
  t.check(desktopBefore, {
    layout: { kind: "split" },
    panes: { left: cards(["a", "b"], "b"), right: CHAT_PANE },
  });

  // doctest:L169
  state = reduceWorkspace(state, { type: "restoreCards", viewport: "mobile" }).state;
  t.check(projectWorkspace(state, "mobile"), cardOnly("left", "b"));
});

// Mobile Show conversation restores the card just put aside, even when the chat
// anchor points to the other pane and that pane also retains cards.
void test("Mobile Show conversation restores the card just put aside, even when the chat...", async (t) => {
  // doctest:L178
  let state = open(createEmptyWorkspaceState(), { path: "left", at: 1 });
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  state = open(state, { path: "right", at: 2 });
  state = reduceWorkspace(state, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
  state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
  state = reduceWorkspace(state, { type: "selectTab", path: "right", at: 3, viewport: "mobile" }).state;
  state = reduceWorkspace(state, { type: "showChat", pane: "right", viewport: "mobile" }).state;
  t.check({ chatAnchor: state.chatAnchor, mobileView: state.mobileView, projection: projectWorkspace(state, "mobile") }, {
    chatAnchor: "left",
    mobileView: { kind: "chat", returnPath: "right" },
    projection: fullChat("right"),
  });

  // doctest:L188
  state = reduceWorkspace(state, { type: "restoreCards", viewport: "mobile" }).state;
  t.check(projectWorkspace(state, "mobile"), cardOnly("right", "right"));
});

// ## Desktop foreground follows the last activated visible pane
//
// Both panes remain visible, but attention follows selection rather than always
// falling onto the right-hand projection.
void test("Both panes remain visible, but attention follows selection rather than always...", async (t) => {
  // doctest:L199
  let state = open(createEmptyWorkspaceState(), { path: "left", at: 1 });
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  state = open(state, { path: "right", at: 2 });
  state = reduceWorkspace(state, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
  state = reduceWorkspace(state, { type: "selectTab", path: "right", at: 3, viewport: "desktop" }).state;
  t.check(projectWorkspace(state, "desktop"), {
    visiblePanes: [{ pane: "left", path: "left" }, { pane: "right", path: "right" }],
    visiblePaths: { left: "left", right: "right" },
    transcript: null,
    foregroundPath: "right",
    restorePane: null,
  });

  // doctest:L207
  state = reduceWorkspace(state, { type: "selectTab", path: "left", at: 4, viewport: "desktop" }).state;
  t.check(projectWorkspace(state, "desktop"), {
    visiblePanes: [{ pane: "left", path: "left" }, { pane: "right", path: "right" }],
    visiblePaths: { left: "left", right: "right" },
    transcript: null,
    foregroundPath: "left",
    restorePane: null,
  });
});

// ## Closing repairs selections, mobile return, and focused empty panes
void test("Closing repairs selections, mobile return, and focused empty panes", async (t) => {
  // doctest:L215
  let state = open(createEmptyWorkspaceState(), { path: "a", at: 1 });
  state = reduceWorkspace(state, { type: "focusPane", pane: "left" }).state;
  state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "mobile" }).state;
  state = reduceWorkspace(state, { type: "closeTab", path: "a", viewport: "mobile" }).state;
  t.check({ layout: state.layout, mobileView: state.mobileView, panes: state.panes }, {
    layout: { kind: "split" },
    mobileView: { kind: "chat", returnPath: null },
    panes: { left: CHAT_PANE, right: CHAT_PANE },
  });
});

// Closing the active foreground tab in the left pane keeps attention on its left
// neighbour even while a second card remains visible on the right.
void test("Closing the active foreground tab in the left pane keeps attention on its lef...", async (t) => {
  // doctest:L231
  let state = open(createEmptyWorkspaceState(), { path: "left-a", at: 1 });
  state = open(state, { path: "left-b", at: 2 });
  state = reduceWorkspace(state, { type: "showChat", pane: "left", viewport: "desktop" }).state;
  state = open(state, { path: "right", at: 3 });
  state = reduceWorkspace(state, { type: "restoreCards", pane: "left", viewport: "desktop" }).state;
  state = reduceWorkspace(state, { type: "selectTab", path: "left-b", at: 4, viewport: "desktop" }).state;
  state = reduceWorkspace(state, { type: "setViewport", viewport: "mobile" }).state;
  state = reduceWorkspace(state, { type: "setViewport", viewport: "desktop" }).state;
  state = reduceWorkspace(state, { type: "closeTab", path: "left-b", viewport: "desktop" }).state;
  t.check({ panes: state.panes, projection: projectWorkspace(state, "desktop") }, {
    panes: { left: cards(["left-a"], "left-a"), right: cards(["right"], "right") },
    projection: {
      visiblePanes: [{ pane: "left", path: "left-a" }, { pane: "right", path: "right" }],
      visiblePaths: { left: "left-a", right: "right" },
      transcript: null,
      foregroundPath: "left-a",
      restorePane: null,
    },
  });
});

// ## Plain reopen preserves an authored target
//
// A link that names only the path activates the existing tab without erasing its
// viewer, params, or authored view state. Those fields change only when the new
// open intent explicitly supplies them.
void test("A link that names only the path activates the existing tab without erasing it...", async (t) => {
  // doctest:L251
  let state = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard",
    target: { path: "a", viewer: "canvas", params: { mode: "detail" }, viewState: { frame: 4 } },
    label: "authored a", at: 1, viewport: "desktop",
  }).state;
  state = open(state, { path: "a", at: 2 });
  t.check(tab(state, "a").target, {
    path: "a",
    viewer: "canvas",
    params: {
      mode: "detail",
    },
    viewState: {
      frame: 4,
    },
  });
});

// ## A moved card retargets the existing tab
//
// The move keeps the pane, renderer parameters, pin, and active-card identity. It
// does not open a second tab at the destination path.
void test("The move keeps the pane, renderer parameters, pin, and active-card identity.", async (t) => {
  // doctest:L267
  let state = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard",
    target: { path: "old", viewer: "canvas", params: { page: "2" }, viewState: null },
    label: "Moved card", at: 1, viewport: "desktop",
  }).state;
  const retargeted = reduceWorkspace(state, {
    type: "retargetCard",
    fromPath: "old",
    target: { ...tab(state, "old").target, path: "archive/new" },
  });
  state = retargeted.state;
  t.check(
    {
      paths: Object.keys(state.tabs),
      pane: state.panes.left,
      target: tab(state, "archive/new").target,
      interaction: state.lastInteraction,
      effect: retargeted.effect,
    },
    {
    paths: [
      "archive/new",
    ],
    pane: {
      paths: [
        "archive/new",
      ],
      activePath: "archive/new",
      display: "cards",
    },
    target: {
      path: "archive/new",
      viewer: "canvas",
      params: {
        page: "2",
      },
      viewState: null,
    },
    interaction: {
      kind: "card",
      path: "archive/new",
    },
    effect: {
      kind: "none",
    },
  },
  );

  // doctest:L287
  let pathLabeled = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard",
    target: { path: "old", viewer: null, params: {}, viewState: null },
    label: "old", at: 1, viewport: "desktop",
  }).state;
  pathLabeled = reduceWorkspace(pathLabeled, {
    type: "retargetCard",
    fromPath: "old",
    target: { ...tab(pathLabeled, "old").target, path: "archive/new" },
  }).state;
  t.check(pathLabeled.tabs, {
    "archive/new": { target: target("archive/new", null), label: "archive/new", pinned: false, lastActiveAt: 1 },
  });
});

// When the destination is already open, its richer tab state wins and the stale
// source tab is removed without moving or focusing the destination.
void test("When the destination is already open, its richer tab state wins and the stale...", async (t) => {
  // doctest:L305
  let converging = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard",
    target: { path: "archive/new", viewer: "canvas", params: { page: "9" }, viewState: { frame: 4 } },
    label: "Existing destination", at: 1, viewport: "desktop",
  }).state;
  converging = reduceWorkspace(converging, { type: "togglePin", path: "archive/new", at: 2 }).state;
  converging = reduceWorkspace(converging, {
    type: "openCard",
    target: { path: "old", viewer: "Source", params: {}, viewState: null },
    label: "old", at: 3, viewport: "desktop",
  }).state;
  const converged = reduceWorkspace(converging, {
    type: "retargetCard",
    fromPath: "old",
    target: { ...tab(converging, "old").target, path: "archive/new" },
  });
  t.check(
    {
      paths: Object.keys(converged.state.tabs),
      destination: converged.state.tabs["archive/new"],
      active: converged.state.panes.left.activePath ?? converged.state.panes.right.activePath,
      effect: converged.effect,
    },
    {
    paths: [
      "archive/new",
    ],
    destination: {
      target: {
        path: "archive/new",
        viewer: "canvas",
        params: {
          page: "9",
        },
        viewState: {
          frame: 4,
        },
      },
      label: "Existing destination",
      pinned: true,
      lastActiveAt: 2,
    },
    active: "archive/new",
    effect: {
      kind: "none",
    },
  },
  );
});

// ## Move and focus are explicit card interactions
void test("Move and focus are explicit card interactions", async (t) => {
  // doctest:L333
  let state = open(createEmptyWorkspaceState(), { path: "a", at: 1 });
  state = reduceWorkspace(state, { type: "moveActive", pane: "left" }).state;
  t.check(state.lastInteraction, {
    kind: "card",
    path: "a",
  });

  // doctest:L338
  state = reduceWorkspace(state, { type: "focusPane", pane: "right" }).state;
  t.check(state.lastInteraction, {
    kind: "card",
    path: "a",
  });
});

// ## Restore normalizes corrupt ownership instead of fabricating cards
//
// Duplicates keep their first owner, missing registry paths disappear, active
// paths fall back to a real tab, empty card displays become chat, and invalid
// focus/mobile references are repaired.
void test("Duplicates keep their first owner, missing registry paths disappear, active p...", async (t) => {
  // doctest:L350
  const seed = { target: target("a", null), label: "a", pinned: false, lastActiveAt: 1 };
  const repaired = normalizeWorkspaceState({
    version: 2,
    tabs: { a: seed },
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
  t.check(repaired, {
    version: 2,
    tabs: { a: seed },
    panes: { left: cards(["a"], "a"), right: CHAT_PANE },
    layout: { kind: "split" },
    lastCardPane: "right",
    chatAnchor: "right",
    mobileView: { kind: "card", path: "a" },
    lastInteraction: { kind: "chat" },
  });
});

// ## The unpinned cap is global and protects both pane selections
void test("The unpinned cap is global and protects both pane selections", async (t) => {
  // doctest:L374
  let state = createEmptyWorkspaceState();
  for (let i = 0; i < 12; i++) state = open(state, { path: `l${i}`, at: i + 1, originatingPane: "left" });
  state = open(state, { path: "right-active", at: 20, originatingPane: "right" });
  t.check(
    Object.entries(state.tabs).filter(([, candidate]) => !candidate.pinned).map(([path]) => path),
    ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11", "right-active"],
  );

  // doctest:L380
  t.check(state.panes, {
    left: cards(["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11", "right-active"], "right-active"),
    right: CHAT_PANE,
  });
});
