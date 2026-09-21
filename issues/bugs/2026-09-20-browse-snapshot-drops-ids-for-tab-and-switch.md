---
title: "bin/browse snapshot -i omits the DOM id for tab, switch, and tabpanel roles"
workstream: unattached
area: beebox
labels: [browse, dev-tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-collection-views — chasing a reported missing id on the todo-view controls
---

> **Cause found 2026-09-21, and it is ours, not agent-browser's.** The title's
> role theory is wrong. `bin/browse` annotates snapshots from the app's own
> scan (`window.__bbxUiScan()`, `browse/src/act.ts` → `liveScan`), and the scan
> reports these elements with `id: null`. Verified live on `/main/test1/browse`:
>
>     raw DOM   {"role":"tab","id":"bbx-workspace-tab-_config%2Finterface%2Flandmarks.card"}
>     __bbxUiScan {"role":"tab","id":null,...}
>
> The filter is `CONTROL_ID_PATTERN = /^bbx(?:-[\da-z]+)+$/`
> (`beebox/src/frontend/src/lib/ui-scan/resolve.ts:28`) — "bbx- plus kebab-case
> segments, nothing that would need escaping". That id carries `%2F`, uppercase
> and a dot, so it fails and `scan.ts:104` returns null.
>
> So the rule is **any id that is not lowercase kebab-case is invisible to the
> tooling, whatever its role**. Tabs looked role-shaped because workspace tab
> ids embed an encoded card path. The issue's own unexplored note points the
> same way: `bbx-card-properties-:r0:` is a *button*, and React `useId` colons
> fail the same pattern.
>
> Same pattern gates `resolve.ts:61`, which answers `bad-id`, so an
> id-addressed action on these controls presumably cannot target them either —
> check that, because it makes this more than a display bug.
>
> **Still unexplained:** `bbx-todo-view-show-finished` (the `switch` above) is
> plain kebab-case and should pass. Either that one has a second cause — the
> annotator matches by role plus accessible name (`browse/src/controls.ts`,
> `annotateSnapshot`), so a name mismatch also drops the id — or it was
> mis-copied. It was on a page in `worktree-collection-views`, not checked here.
>
> The fix is a decision, not a patch: widen the pattern to the ids the app
> actually mints, or stop minting ids that cannot be addressed. Encoded card
> paths and `useId` colons are two different offenders.

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
