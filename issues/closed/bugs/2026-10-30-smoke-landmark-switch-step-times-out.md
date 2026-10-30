---
title: "`bin/smoke`'s landmark-switch step times out though the switch works by hand"
workstream: shared-browser
area: bin
labels: [smoke, flake]
filed-by: agent
discovered-by: agent
discovered-in: "shared-browser — finish, 2026-10-30"
resolution: implemented
---

**Closed (implemented, 2026-10-30):** the agent-browser 0.41.0 upgrade for `bin/browse` (005ea5b13) ended the timeouts. On `120a703d0` the step passed in all 17 smoke runs that reached it, at 3.7 to 10.1 s; before, it failed 4 of 6 on the same box. The cause is inferred, as the slow call was not caught in the act: agent-browser 0.27.0's `snapshot` is [known to hang](2026-07-14-browse-daemon-wedges-on-animated-canvas.md) on an unstarted chat, cleared by removing `#bbx-nav-place` from the page, and this step's first call is a `snapshot` of that page. The same runs found a different fault: [the dev router stalls in a write to its terminal](../../bugs/2026-10-30-dev-router-stalls-writing-to-its-terminal.md).

The step "selecting a landmark switches the conversation" (`place-switch` in
`bin/smoke.ts`) runs about 100 s and the whole smoke is killed at its budget.
On `worktree-shared-browser` at `99606771a` and `2bb0fe926` it failed in 4 of
6 runs whose earlier steps passed, with `bin/browse` on agent-browser 0.27.0
(main's version). The shared smoke log
(`.git/beebox-smoke-log.jsonl`) shows the same failure 7 times on
`worktree-pi-engine` at `c5000f809` between 01:16 and 01:53 UTC the same day,
followed by green runs. Earlier runs on other branches were green.

By hand, on the same box and dev server, the same switch is quick: open the
place menu (`bin/browse click bbx-nav-place`), click the "Porch rebuild" row,
and within 2 s the URL carries the landmark card, the place pill reads
"Porch rebuild", and `document.body.dataset.bbxLoading` is `"false"`. So the
time goes inside the step: its `snapshot`, `click`, `waitForReady`, or
`getUrl` calls, each of which can wait up to `bin/browse`'s 15 s ready
timeout.

Not established: whether `main` fails the same way (running `bin/smoke` there
restarts main's dev server, and it was not run), and which call in the step
takes the time.

Done when the step's slow call is found and the step passes on a healthy box,
or the cause is shown to lie outside the smoke.
