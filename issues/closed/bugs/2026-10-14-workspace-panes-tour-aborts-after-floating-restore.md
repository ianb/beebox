---
title: "workspace-panes tour aborts after its floating-restore checkpoint (os error 35)"
workstream: browse-wedge
area: beebox
labels: [tours, browse]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261014-221119
resolution: implemented
---

**Closed (implemented, 2026-10-30):** The display was asleep during the scheduled runs; bin/tour now wakes it and holds it on (ea3502dff). Verified from a dark display on 2026-10-30.

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

Related: [browse daemon wedges (os error 35) on animated canvas](../../bugs/2026-07-14-browse-daemon-wedges-on-animated-canvas.md)
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
`Theme_Tour.doc.card` ([fixture issue](../../docs-and-chores/2026-09-23-test1-lacks-theme-tour-fixtures.md)),
so the card pane shows "Card not found". Artifacts:
`beebox/test/tours/.artifacts/workspace-panes/2026-10-22T04-15-21-598Z/`.

## Re-encounter, 2026-10-28 - weekly tour check run 20261028-161719

Solo `bin/tour workspace-panes`. Both viewports wrote
`card-beside-conversation` and `conversation-with-floating-restore`, then the
run made no progress and was killed after 15 minutes, before it wrote a
`summary.md`. In the first `--all` run the 30-minute limit expired before
this tour started. `Theme_Tour.doc.card` now loads ("Card themes tour" shows
in the pane). Artifacts:
`beebox/test/tours/.artifacts/workspace-panes/2026-10-28T22-06-39-911Z/`.

## Cause and fix, 2026-10-30 (browse-wedge)

The display was asleep. Solo `bin/tour workspace-panes` runs tonight:

| Display | Wrapper | Result |
|---|---|---|
| held awake | unchanged | 3 checkpoints, 0 findings, 3 m 13 s |
| held awake | 713bf637e | 3 checkpoints, 0 findings, 3 m 37 s |
| asleep since 03:11 | 3fe63cc70 | both viewports aborted at the first screenshot: "screenshot did not finish within 45 s … the display is asleep"; 2 m 38 s |
| woken, then `caffeinate -d` | 3fe63cc70 | 3 checkpoints, 0 findings |
| asleep at start | ea3502dff (`bin/tour` runs under `caffeinate -u -d`) | display turned on; 3 checkpoints, 0 findings, 3 m 11 s |

The page does not trigger the abort. The earlier `Page.captureScreenshot` and `DOM.enable` timeouts and the 27-minute run are what a stalled capture looks like on agent-browser 0.27.0 ([daemon wedge issue](../../bugs/2026-07-14-browse-daemon-wedges-on-animated-canvas.md)). Artifacts: `beebox/test/tours/.artifacts/workspace-panes/2026-10-30T08-32-16-506Z/` (asleep) and `2026-10-30T08-39-28-542Z/` (fixed).
