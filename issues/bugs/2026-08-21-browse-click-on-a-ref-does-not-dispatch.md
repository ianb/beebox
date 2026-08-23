---
title: "bin/browse click on a snapshot ref reports success without clicking anything"
workstream: unattached
area: bin
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — driving app controls from snapshot refs
---

`bin/browse click @<ref>` exits 0 and prints its usual success output while the
page does not change. Dispatching a DOM `.click()` on the same element through
`bin/browse eval` works every time.

Three independent page checks hit it on different controls:

- `/admin`: clicking the "Create invite link" submit button sent no network
  request; the same button clicked via `eval` sent `admin.createInvite`.
- `/questions`: clicking Submit Answer / Dismiss left the button state and the
  card unchanged; `eval` clicks answered and dismissed the question.
- `/inventory`: clicking the Area-view tabs (custom `role=tab` buttons with
  roving tabindex) did not change the selected tab; `element.click()` did.

**The cause was not located.** It is not clear whether the ref resolves to the
wrong node, the coordinate-based dispatch lands outside the element, or the
event is sent before the element is hittable. Refs also renumber between
snapshots, so a stale ref is a candidate, but a stale ref would be expected to
report a failure rather than success.

A silent no-op is the expensive part: a checker reads "clicked" and then
attributes the unchanged page to the app.

Related: [agent-browser mouse wheel dispatch is flaky](2026-08-09-agent-browser-wheel-dispatch-flaky.md).
