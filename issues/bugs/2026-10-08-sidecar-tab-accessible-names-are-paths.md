---
title: "Sidecar tab buttons are named with the file path for screen readers"
workstream: unattached
area: beebox
labels: [accessibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending and C-reconnecting journey walks, 2026-10-08
---

The close and pin buttons on a card tab have the accessible names
`Close _content/friends/Reconnecting.doc.card` and `Pin …` with the same path.
The visible tooltips say "Close tab" and "Pin tab". A screen-reader user
hears a file path; the walkers, who read the accessibility tree, reported two
names for one page
([A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) row 9,
[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) row 17).

## Mechanism

- `beebox/src/frontend/src/components/chat/workspace/SidecarTabStrip/view.tsx:184`
  and `:203` set `aria-label` to `` `Pin ${tab.label}` `` / `` `Close ${tab.label}` ``.
- `label` defaults to the card path when the opener gives none:
  `label: hint?.label ?? target.path`
  (`beebox/src/frontend/src/components/chat/workspace/WorkspaceProvider/provider.tsx:175`),
  and `openCard` from several callers passes `incoming.path`
  (`provider.tsx:34`, `:59`, `:142`).

## Fix direction

Name the tab by the card title. The tab text itself is probably already the
title once the card loads
([a tab keeps the label it was opened with](../closed/bugs/2026-09-05-sidecar-tab-label-never-updates.md),
closed). Check that the button name follows the same source.
