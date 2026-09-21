---
title: "bin/browse snapshot -i omits the DOM id for tab, switch, and tabpanel roles"
workstream: unattached
area: beebox
labels: [browse, dev-tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-collection-views — chasing a reported missing id on the todo-view controls
---

`bin/browse snapshot -i` (agent-browser 0.27.0) reports `id=` for buttons,
links, and textareas, and reports no id for elements whose role is `tab`,
`switch`, or `tabpanel` — even when those elements carry a `bbx-` id. On the
worktree app it printed

    - tab "By place" [selected, ref=e61]
    - switch "Show finished" [checked=false, ref=e42]

while the same page's DOM has `bbx-todo-view-group-place`,
`bbx-todo-view-group-plate`, and `bbx-todo-view-show-finished` on exactly
those elements (`bin/browse eval` over `[id^=bbx-]` lists all three). Every
`bbx-workspace-tab-*`, `bbx-workspace-panel-*`, and `bbx-browse-listing-mode`
address is invisible the same way, so it is the role and not the page.

This reads as a missing address: a reviewer comparing the snapshot against the
source concludes the component or the primitive dropped the id, and goes
looking for a bug in `TabBar`/`Toggle` that is not there. Both primitives pass
`id` straight to the rendered element.

Not investigated: whether ids containing `:` are dropped for a second reason
(`bbx-card-properties-:r0:`, a `button`, also prints without an id, and React
`useId` values are the only `bbx-` addresses that contain colons), and whether
a newer agent-browser fixes it. The binary is opaque, so this was established
by comparing `snapshot -i` against `eval` on the live page.

Workaround: confirm an address with
`bin/browse eval 'document.getElementById("bbx-…") !== null'` rather than by
reading `snapshot -i`.
