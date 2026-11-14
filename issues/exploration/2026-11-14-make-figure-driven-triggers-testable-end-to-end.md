---
title: "Make a figure-driven activity trigger testable end to end"
workstream: activity-triggers
needs: [design]
area: beebox
labels: [triggers, figures, views, activity, testing]
filed-by: agent
discovered-by: Ian
discovered-in: "activity-triggers workstream, the live check of the first fire, 2026-11-14"
---

The live check of activity triggers (`docs/implemented-plans/activity-triggers.md`,
Rollout shape) could not click the figure: the headless Chromium that
`bin/browse` drives never fires `requestAnimationFrame`, and a canvas-loop
figure flushes its input on frames. The check posted the figure's activity
entry from the page instead, and the figure's own reporting was checked
separately with `bbx figure run`. So no single test covers the chain a
person actually exercises: click in a figure or view → activity entry →
server runner → trigger function → fire in the chat → agent turn.

The boxholder wants this testable, perhaps with a more fully mocked
situation, and is not sure where the mocking goes: the same chain serves
views (`reportActivity`) and figures (canvas-loop `activity(model)`), and
the activity queue, the runner and the chat delivery are each tested on
their own.

Places a mock or a driver could sit:

- The page's activity queue (`src/frontend/src/lib/activity/page-queue.ts`):
  a browser test that posts entries as the queue would, which is what the
  live check did by hand. Covers everything after the page, nothing in it.
- The canvas-loop headless runner (`bbx figure run`): already produces the
  `activity` lines a figure would log; a replay adapter into
  `bbx chat trigger run --activity` would join the two halves without a
  browser (listed NOT in scope in the plan).
- A browser driver that advances frames: `bin/browse` with a flag that
  forces animation frames in the headless page, or a scripted events file
  the FigureMount accepts in a test mode, so a figure can be driven in the
  pane.
- A whole-chain scenario test under `test/scenarios/` with a fake chat
  backend, the real runner and a real trigger file.

Decide which layer earns the test and whether the view path and the figure
path share it.
