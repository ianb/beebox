---
title: "Search section results open the document without the selected section"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey C and independent verification
priority: normal
---

Journey C searched for its saved friends page and selected the result labelled
`Section: /Reconnecting with friends/Where things stand right now`. The document
opened at its beginning; the walker had to bring the status heading into view.
The section label promises a more precise destination than the click supplies.

## Verified mechanism

`beebox/src/frontend/src/renderers/search.tsx:37` constructs a navigation target
from `item.path` with empty params/view state. It drops `item.fragment`.
`beebox/src/frontend/src/components/search/QuickSearchOverlay.tsx:35` has the
same omission. The Cmd-K path was source-checked, not exercised in this walk.

The selected heading was near the bottom of the viewport in screenshot 21;
this is not a claim that the document failed to open. It opened successfully
without using the section destination. Wire the existing section identity
through navigation and verify both search entry points.

Evidence: [journey C report](../../beebox/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 37–40, screenshots 20–22. Related history:
[box search](../closed/features/2026-05-11-box-search.md).
