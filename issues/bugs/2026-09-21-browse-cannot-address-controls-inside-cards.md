---
title: "bin/browse cannot address any control inside a card, because it reads the chrome-only agent scan"
workstream: unattached
area: beebox
labels: [browse, dev-tooling]
needs: [decision]
next-action: discuss
filed-by: agent
discovered-by: agent
discovered-in: worktree-browse-id-pattern — while fixing the address grammar half of 2026-09-20
---

`bin/browse` learns which snapshot line carries which `bbx-` id by calling
`window.__bbxUiScan()`, the same walk that answers the agent's `bbx chat ui`
dump. That walk is chrome-only by design: a subtree marked
`data-bbx-scan="exclude"` is pruned, which is what lets the dump be handed to
the agent with no consent prompt (`chat/ui-scan-request-handler.ts`, and
`docs/plans/agent-points-at-ui.md` Track 3). Card bodies, the transcript and
embeds all sit below that boundary.

Annotated controls sit below it too, which the boundary's own docstring denied
("No `bbx-` address sits inside an excluded subtree"). Measured on
`/browse-id-pattern/test1/browse`: `bbx-browse-listing-mode` (role `switch`) and
`bbx-card-properties-…` are in the DOM and absent from the scan entirely. So
`snapshot -i` prints them with no id, and a walker told to act by id has
nothing to use. `bbx-todo-view-show-finished`, the control the original report
started from, is the same case.

This is the remaining half of
`issues/bugs/2026-09-20-browse-snapshot-drops-ids-for-tab-and-switch.md`; the
address-grammar half is fixed.

## The decision

The dump is right not to carry card content — the agent reads a card by opening
it. `bin/browse` is a developer tool driving the developer's own page and wants
every address on it. The options are not equivalent:

- Give the window hook a scope argument (`chrome` by default, `document` for
  `bin/browse`), leaving the route handler's payload untouched. Small, and it
  fixes every card control at once. It also turns "content-free by
  construction" into "content-free unless the caller asks", on a hook exposed
  unconditionally — the reasoning that anything able to `eval` can already read
  the DOM says that costs nothing, but the no-consent-prompt argument rests on
  the stronger phrasing.
- Have `bin/browse` collect addresses from the DOM itself rather than from the
  scan, leaving the app alone. It needs role and accessible name to match a
  snapshot line, which is the machinery the scan already owns, so this means
  duplicating it in a package that cannot import it.
- Leave it, and document that controls inside a card are ref-addressed only.
  Refs are the unchecked, renumbering path the id scheme exists to replace.

The first is what I would do, but it moves a line the plan records as a
judgment call the boxholder should confirm, so it is not mine to move.
