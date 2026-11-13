---
title: "Pane controls group name hides the pane name from the tour label audit"
workstream: unattached
needs: [decision]
area: beebox
labels: [tours, a11y]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261111-153355
---

Commit 5400d888b (lint rule `aria-label-needs-role`) gave the pane button
cluster in `beebox/src/frontend/src/components/chat/workspace/PaneControls.tsx`
`role="group"` with the fixed name "Pane controls". Before that change, the
browser ignored the label. Now the nearest named container for "Focus card",
"Minimize cards" and "Move right" is "Pane controls" in every pane. The pane
names ("Left pane", "Right pane" in `WorkspaceCanvas/view.tsx`, and the specimen
names in the theme studio) no longer tell the panes apart. The tour label audit
reports the repeats again. The a11y-labels work had resolved them (see
`issues/closed/code-quality/2026-10-28-duplicate-control-names-need-an-object.md`).

The tour check did not change the name. Eleven theme stylesheets under
`beebox/src/frontend/src/themes/` (`deck.css`, `phosphor.css`,
`overprint.css`, `gilt-chrome.css` and others) select
these buttons with `[aria-label="Pane controls"]`. If
the label is removed or renamed, those themes stop styling the buttons.

Options:

- Remove the group role and label from the cluster, and move the theme
  selectors to a class or a `data-` attribute. The enclosing pane group then
  names the buttons.
- Keep the group and give it a per-pane name, passed by the caller ("Left pane
  controls", or the studio specimen). The themes would then select by
  attribute prefix or class.

## Evidence

- `card-theme-interface` `browse-card-desk` desktop: 2 "Focus card" and 2
  "Minimize cards" in "Pane controls".
  `beebox/test/tours/.artifacts/card-theme-interface/2026-11-11T22-14-05-602Z/browse-card-desk.desktop.labels.json`
- `theme-studio` `draft-theme` and `card-material`: 3 each of "Move right",
  "Focus card" and "Minimize cards" (desktop), 3 "Minimize cards" (mobile).
  `beebox/test/tours/.artifacts/theme-studio/2026-11-11T22-10-13-254Z/draft-theme.desktop.labels.json`
