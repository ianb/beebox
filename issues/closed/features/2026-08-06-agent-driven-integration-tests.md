---
title: "Full agent-driven integration tests exercising realistic box activities"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder, soft-launch confidence
labels: [soft-launch]
resolution: implemented
---

> **Closed 2026-08-08.** Built end-to-end in
> `docs/implemented-plans/agent-field-tests.md`: the `bbx field-test run|list|report`
> harness, an agent operator driving the real web UI (`bin/browse`) against a
> fresh box with real agent processing, and a first full real
> `onboarding-first-days` run completed (all 6 checklist items, 2h 8m, 3
> simulated days). The run's product/harness findings are filed separately as
> `field-test-findings`-labeled issues, not fixed here — that's the tier doing
> its job. `issues/features/2026-07-22-modeled-demo-family-box.md` stays open
> (deferred; v1 starts from an empty box).

> **Job to be done:** *Before I show a box to people, I want confidence that the
> real end-to-end flows actually work — not unit tests, but a person's actual
> activities: add a recipe, ask for it back later, upload a document, get an email
> that turns into a task — driven through REAL agent processing. So a launch-day
> surprise shows up in a periodic test run, not in front of a visitor.*

Build a suite of **full integration tests** that exercise realistic box activities
with **serious, real agent interaction** — the point is to drive the actual agent
processing end-to-end, not to fake it. It is fully automated but **expensive** (real
agent runs + a browser), so it is **NOT** a CI/scheduled gate — it runs **once a
week, or as part of manual testing**, from a script, driving the browser and
**watching for problems as it goes** (agent-in-the-loop observation, not just
green/red asserts).

## Activities to cover (day-to-day jobs, not corner cases)

Adding recipes; retrieving things previously added; adding/uploading documents and
photos (capture + bulk upload); email arriving and becoming a task; and the other
mundane flows a real user does. Each is exercised through the real UI + the agent.

## Fixtures / harness pieces needed

- **A test-asset corpus** — realistic images/files/documents to upload (capture
  inputs, a scanned doc, a few photos), checked in or generated.
- **Faked email connectors** — feed synthetic emails without a real inbox (the
  services already have real+fake impls; extend the email connector fake to drive
  intake deterministically).
- **Fake personas for the user(s)** — CREATE, or revive/reuse what exists. This ties
  directly to
  [modeled-demo-family-box](../../features/2026-07-22-modeled-demo-family-box.md): the fictional
  family is the personas + the realistic starting data these tests act as / act on.
- **Box lifecycle** — create a fresh box, seed personas/data, run the activities,
  interact with it (browser + CLI), tear it down.

## Nature of the run (design the shape with the boxholder)

- **Real agent runs cost real quota** → cadence is weekly / manual, and the run is a
  script the operator (or an agent) kicks off, not a cron. Decide how many activities
  per run.
- **Assertions vs. observation.** Some checks are hard asserts (the uploaded document
  is later retrievable; the recipe card exists with the right fields). But the
  boxholder's framing is **an agent pays attention as it goes** — watching for wrong
  agent behavior, errors, broken UI — a richer signal than pass/fail. Design both: a
  spine of hard asserts plus an agent-observer pass that flags anything off.
- **Browser-driven** — use `bin/browse` / agent-browser to drive the real chat /
  capture / upload surfaces, since the point is the whole stack including the UI.

## Build on what exists

- The **`bbx scenario` harness** (`beebox/src/scenario/` — loader/runner/types;
  `docs/testing.md`) already does multi-step end-to-end fixtures with checkpoints and
  `--from`/`--dry-run`. Extend or complement it rather than starting fresh — it may be
  the right backbone for the activity scripts, with the browser + agent-observer layer
  on top.
- Service fakes (`src/services/` real+fake) for the connectors.

## Related

- [modeled-demo-family-box](../../features/2026-07-22-modeled-demo-family-box.md) — the personas +
  realistic data (create-or-revive); the natural fixture source for this.
- [demo-readiness](../../docs-and-chores/2026-05-22-demo-readiness.md) — adjacent
  demo-prep chore.
- `docs/testing.md` — the scenario/doctest tiers this sits above.
