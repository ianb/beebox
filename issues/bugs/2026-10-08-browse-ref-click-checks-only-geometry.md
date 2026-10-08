---
title: "bin/browse reports Done for a click on a covered control that has no bbx- id"
workstream: unattached
area: browse
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
---

In the C-reconnecting walk the first click on a todo checkbox did nothing and
the second worked. The reviewer reproduced it: a checkbox scrolled to y=524
sat under the full-width conversation layer (`elementFromPoint` returned
`.bbx-conversation-desk`). `bin/browse click @ref` printed `✓ Done` and no
commit followed. A person cannot click a control hidden under the composer
band, so the tool reported a success the app never saw.

## Mechanism (partly unverified)

Todo checkboxes carry no `bbx-` id, so `checkedAction` takes the `@eN` path
(`browse/src/act.ts:274-278`; the doc comment says "only geometry can be
checked"). The ref path runs `checkAtBox` (`act.ts:251-269`): `judgeBox` for
size and viewport, then an `elementFromPoint` check at the box centre
(`browse/src/controls.ts:288-295`). That check reports `covered` only when the
element at the point does not carry the snapshot's name for the ref. It
tests a name substring (`namesOf(el)…includes(want)`). A large covering
container whose text contains the name ("Open") would pass. If `expectName` is
null, no cover check runs at all. Neither case was confirmed against the
reproduced click; the report only shows the covering element and the false
`✓ Done`.

## Fix direction

For the ref path, require the hit element to be the target or inside it, as
the id path does (`controls.ts:316-323`), instead of matching names. Resolve
the ref to a node for that. Related:
[todo checkbox name is its status](2026-10-08-todo-checkbox-name-is-its-status.md)
(a name of "Open" is also what makes a substring match easy).

Report: [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 37).
