---
title: "The app mints bbx- ids outside the address grammar, so the scan drops them and bin/browse cannot act on them"
workstream: browse-id-pattern
area: beebox
labels: [browse, dev-tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-collection-views — chasing a reported missing id on the todo-view controls
---

A control address is an HTML `id` matching `/^bbx(?:-[\da-z]+)+$/` — lowercase
kebab-case, nothing a CSS selector would need escaped. Three components built
ids out of runtime data and interpolated it raw, producing ids outside that
grammar:

- `bbx-workspace-tab-${encodeURIComponent(path)}` and the matching
  `bbx-workspace-panel-…` (`chat/SidecarTabStrip.tsx`,
  `chat/workspace/WorkspaceCanvas.tsx`) — `%`, uppercase hex, and a dot.
- `bbx-card-properties-${useId()}` and the card's front/back ids
  (`themes/CardThemeSurface.tsx`) — React spells `useId` with colons.

The scan reports such an id as `id: null` (`lib/ui-scan/scan.ts` `addressOf`),
so `bin/browse snapshot -i` prints the control with no address; `resolveControl`
answers `bad-id` before touching the document; and `bin/browse` parses the
string as a CSS selector, which Chrome refuses:

    ✗ click bbx-workspace-tab-_config%2Finterface%2Fbrowse.card refused: bad-selector
      — 'bbx-workspace-tab-…' is not a valid selector

That is the hole the id-addressing scheme exists to close
(`issues/closed/bugs/2026-08-21-browse-click-on-a-ref-does-not-dispatch.md`):
acting by `@eN` ref is unchecked and renumbers, so walkers and agents are told
to act by `bbx-` id — and for these controls there was no id to act by.

## Fix

`beebox/src/shared/control-address.ts` now owns the grammar, its length cap, and
`controlAddress(prefix, value)`, which base32-encodes a value into it. The
three components mint through it; `DriveMountRow`'s hand-rolled hex encoder,
which solved the same problem for case-sensitive Drive ids, was folded into it.
The scan degrades an over-long address to "no address" rather than emitting one
the wire schema would reject, and reports duplicates only for real addresses.

## Not this, and still open

The original title blamed agent-browser 0.27.0 for dropping `tab`, `switch` and
`tabpanel` roles. It does not; the filter was ours.

The report's `bbx-todo-view-show-finished` has a second, separate cause and is
not fixed here: it is kebab-case and passes the grammar, but it sits inside a
card, and card content is pruned from the scan by `data-bbx-scan="exclude"`.
See `issues/bugs/2026-09-21-browse-cannot-address-controls-inside-cards.md`.
