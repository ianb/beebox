// Opening a card that is already a tab takes the incoming fragment, so a
// search result for a section reaches an open card, and a plain open clears an
// old section without resetting the tab's view.
import { test } from "tap";
import { createEmptyWorkspaceState } from "../../../../src/components/chat/workspace/state-model.js";
import { reduceWorkspace } from "../../../../src/components/chat/workspace/state-reducer.js";
import type { ViewTarget } from "../../../../src/lib/view-url.js";

const path = "_content/Weekly.doc.card";
const open = (state: ReturnType<typeof createEmptyWorkspaceState>, { target, at }: { target: ViewTarget; at: number }) =>
  reduceWorkspace(state, { type: "openCard", target, label: path, at, viewport: "desktop" }).state;
const plain: ViewTarget = { path, viewer: null, params: {}, viewState: null };

test("an open tab takes a new fragment and a plain open clears it", (t) => {
  let state = open(createEmptyWorkspaceState(), { target: { ...plain, viewer: "Source" }, at: 1 });
  state = open(state, { target: { ...plain, fragment: "/Weekly plan/Notes" }, at: 2 });
  t.check(state.tabs[path]?.target, { ...plain, viewer: "Source", fragment: "/Weekly plan/Notes" }); // fragment taken, view kept
  state = open(state, { target: plain, at: 3 });
  t.check(state.tabs[path]?.target, { ...plain, viewer: "Source" }); // plain open clears the fragment, keeps the view
  t.end();
});
