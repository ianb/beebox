---
title: "bin/browse reports Done for a click on a covered control that has no bbx- id"
workstream: unattached
area: browse
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: the id-less ref check (`browse/src/point-check-script.ts`)
finds the ref's element among `document.elementsFromPoint` at the box centre by
the box upstream reported, and refuses `covered` unless the topmost element is
that element, inside it, or its own `<label>`. Name or no name. When no element
there has the box (the control does not take the pointer), the old name check
still applies, so no new refusals there. Upstream `get box` reports viewport
coordinates, the same as `getBoundingClientRect` (checked on a scrolled page).
Pinned by `browse/test/controls.point-check.doctest.md`; in real Chrome a
checkbox under a fixed full-width layer passed the old check with the name
"Open" and with no name, and the new check refuses both.

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

Report: [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 37).

## Residual (2026-10-08 review)

A cross-model review found one case the fix does not cover. An id-less ref
can still pass when a covering element has the same bounding box and the same
accessible name as the control: `elementsFromPoint` lists the cover first, so
the check accepts the cover and the click can miss the control. Not fixed,
because resolving a ref to its DOM element needs changes upstream. The case is
rare.
