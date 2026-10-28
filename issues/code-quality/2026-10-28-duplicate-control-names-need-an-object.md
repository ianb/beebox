---
title: "Repeated control names the tours report that need a naming decision"
workstream: tour-check
area: beebox
labels: [tours, a11y]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261028-161719
needs: [decision]
---

The tour label audit (`beebox/test/tours/tour-lib/labels.ts`) reports
controls that share a role, a name and a container. The weekly tour check
fixed the plain cases (schedule "Run", the Google connection links). Each case
below needs a decision about which object names the control.

## Questions page and question cards in chat

`nav-pages`, checkpoints `questions` and `news`: 38 "Submit Answer" buttons,
38 "Enter your answer..." text boxes, 40 "Answer in chat" and 40 "Later"
buttons, 2 "Yes" buttons, with no named container.

The tour check tried `<Card as="section" aria-labelledby={promptHeadingId}>`
in `QuestionForm`. That reduced the repeats to 5, but axe then reported
`landmark-unique` on both checkpoints, because several pending questions on
`test1` have the same prompt ("What is unsure-001.jpg? …"). The change was
reverted. The options are a non-landmark container that `ui-scan` counts
(it counts landmarks only, `lib/ui-scan/live-dom/scan.ts`), or per-control
names such as "Submit answer to <prompt>".

## Workspace pane controls and the Properties button

`card-theme-interface` `browse-card-desk`, `theme-studio` `draft-theme` and
`card-material`: "Focus card", "Minimize cards", "Properties" repeat once per
pane, and "Move right" repeats in the theme studio, where all three specimens
render `PaneControls pane="left"`. The pane container has no name. The object
can be the pane side ("Focus left card") or the card title (a named region
per pane).

## Tabs and close buttons for cards with the same title

`card-themes` and `card-theme-previews`: up to 4 tabs named "One note, three
stocks" and 2 "Close One note, three stocks" buttons. The four `comparison-*`
fixtures share a title. Two cards with the same title in one workspace are
ordinary on a real box; the tab name could add the path or the stock.

## Others

- `nav-pages` `history`/`dashboard`: "Recent activity" repeats the same link
  ("Set box system theme", "Clear card theme: …") for repeated commits with
  the same subject.
- `nav-pages` `landmarks`: two "New chat" links, one per landmark row.
- `theme-studio`: "Send", "Lock open", "Close keyboard" repeat inside
  "Conversation styling sample".

Artifacts: `beebox/test/tours/.artifacts/<tour>/2026-10-28T2*/<checkpoint>.<viewport>.labels.json`.
