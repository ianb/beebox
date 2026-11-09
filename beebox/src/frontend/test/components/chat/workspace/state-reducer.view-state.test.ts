// A chat "show me" link carries only `viewState`. Opening it on a card that is
// already a tab moves that tab's view state and keeps its viewer, params, and
// label, so the mounted view is not reloaded. A link with params still names a
// whole new target.
import { test } from "tap";
import { createEmptyWorkspaceState } from "../../../../src/components/chat/workspace/state-model.js";
import { reduceWorkspace } from "../../../../src/components/chat/workspace/state-reducer.js";
import type { ViewTarget } from "../../../../src/lib/view-url.js";

const path = "_content/Periodic_Table.chem.card";
const open = (state: ReturnType<typeof createEmptyWorkspaceState>, { target, label, at }: { target: ViewTarget; label: string; at: number }) =>
  reduceWorkspace(state, { type: "openCard", target, label, at, viewport: "desktop" }).state;
const plain: ViewTarget = { path, viewer: null, params: {}, viewState: null };

test("a viewState-only open keeps the tab's viewer, params, and label", (t) => {
  let state = open(createEmptyWorkspaceState(), { target: { ...plain, viewer: "Table", params: { period: "3" } }, label: "Periodic table", at: 1 });
  state = open(state, { target: { ...plain, viewState: { select: "Na" } }, label: "show me", at: 2 });
  t.check(state.tabs[path], { target: { path, viewer: "Table", params: { period: "3" }, viewState: { select: "Na" } },
    label: "Periodic table", pinned: false, lastActiveAt: 2 });
  t.end();
});

test("an open with params replaces the whole target", (t) => {
  let state = open(createEmptyWorkspaceState(), { target: { ...plain, params: { period: "3" }, viewState: { select: "Na" } }, label: "Periodic table", at: 1 });
  state = open(state, { target: { ...plain, params: { period: "4" } }, label: "Period 4", at: 2 });
  t.check(state.tabs[path], { target: { path, viewer: null, params: { period: "4" }, viewState: null },
    label: "Period 4", pinned: false, lastActiveAt: 2 });
  t.end();
});
