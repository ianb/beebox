---
title: "workspace-panes tour aborts after its floating-restore checkpoint (os error 35)"
workstream: tour-check
area: beebox
labels: [tours, browse]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261014-221119
---

The `workspace-panes` tour captures `card-beside-conversation` and
`conversation-with-floating-restore`, then aborts at both viewports. The
next `bin/browse snapshot` fails with "Failed to read: Resource temporarily
unavailable (os error 35) (after 5 retries - daemon may be busy or
unresponsive)". The abort occurs at the same step in two runs: the full
`bin/tour --all` sequence, and a solo `bin/tour workspace-panes` with no
other tour running. The solo run took 27 minutes, most of it in retries.

The app is not the obvious cause. The same steps by hand in a fresh
`bin/browse` session (open the card in a new chat, click "Minimize cards",
click "Restore cards (1)", snapshot) return promptly and show the restored
card. The two captured screenshots are correct: the floating "Restore cards"
control is visible on an empty conversation.

So the tour has produced no result after its second checkpoint for two weeks.
On 2026-10-07 the cause was a different error (`Page.captureScreenshot`
timeouts). The `restored-after-reload` checkpoint and the four
`expect.custom` claims after it are not being checked.

Related: [browse daemon wedges (os error 35) on animated canvas](2026-07-14-browse-daemon-wedges-on-animated-canvas.md)
has the same error text and the same symptom. This page has no canvas.

## Evidence

- Tour: `beebox/test/tours/workspace-panes.tour.ts`, the `click` on
  `/^Restore cards/` after `conversation-with-floating-restore`.
- Artifacts: `beebox/test/tours/.artifacts/workspace-panes/2026-10-15T03-57-53-003Z/`
  and `2026-10-15T04-58-23-073Z/summary.md`.

## Not investigated

- Whether the checkpoint's axe run or screenshot leaves the session in a
  state where the next snapshot fails.
- Whether a `bin/browse close` between checkpoint and click clears it.

## Re-encounter, 2026-10-21 - weekly tour check run 20261021-221418

Solo `bin/tour workspace-panes`. The desktop pass aborted at
`conversation-with-floating-restore` with "CDP command timed out:
DOM.enable" on `snapshot`. The mobile pass aborted at
`card-beside-conversation` on `screenshot`. The box clone also lacks
`Theme_Tour.doc.card` ([fixture issue](../docs-and-chores/2026-09-23-test1-lacks-theme-tour-fixtures.md)),
so the card pane shows "Card not found". Artifacts:
`beebox/test/tours/.artifacts/workspace-panes/2026-10-22T04-15-21-598Z/`.
