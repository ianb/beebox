---
title: "Repair the five tours so they all pass, then check them weekly — a walk nobody runs decays into nothing"
workstream: tour-health
area: callback-box
labels: [tests, tours, schedules]
filed-by: agent
discovered-by: Ian
discovered-in: tab-identity workstream — ran all five tours out of curiosity and three had silently rotted
---

Tours are a development practice, not only a review artifact: **writing the
walk down is more solid than doing it by hand**, because the next person gets
the walk instead of having to invent it again. That value only survives if the
walk still runs, and today three of the five do not.

Measured 2026-08-26 (full findings on
[the merge-time smoke tier issue](../exploration/2026-08-26-merge-time-smoke-tier.md)):
all five still execute, but `browse-walk`, `dashboard` and `capture` each abort
after one checkpoint on a failed soft assertion, while `nav-pages` and
`new-chat` walk clean. Nobody noticed, because nothing runs them
(`callback-box/docs/tours.md` keeps them out of pre-commit and the suite on
purpose) and the artifacts are gitignored.

## What the boxholder asked for

1. **Make the five tours robust — they should all basically pass now.** Some of
   what they flag is not an app regression: `browse-walk` hardcoded a box item
   *count* into a selector (`"box directory, 3357 items"`), so it breaks
   whenever box contents change. Repairing means pinning to stable app
   addresses (`cb-` ids) rather than content-derived labels, so a pass means
   something.
2. **A weekly check that runs them** — and which **may update a tour when the
   app changed deliberately**, rather than reporting a failure.

## Why the update-it clause is the whole design

A weekly agent session that can amend the walk is a different instrument from a
CI gate, and it is the reason this one can survive where a gate would rot. A
gate has exactly one response to intended UI change — go red — so it goes red
every time the app improves, and gets ignored. A session with judgment asks the
other question: *is this drift or is this the new truth?*, and edits the tour
when it is the latter. That is also the only mechanism that keeps the tours
describing the app as it is rather than as it was in May.

The corollary is that the weekly run's output has to be read. A schedule whose
report nobody opens reproduces exactly the failure being fixed here, one level
up.

## Open

- **Where the weekly check runs.** `schedules/<name>/` with a `run` and a
  `prompt.md` is the mechanism (`cb-authoring-schedules`); the tours need a box
  and a dev server, so which checkout and which box it drives is unsettled.
- **What counts as a finding worth reporting** versus a tour edit the agent
  just makes. Axe violations are probably reportable; a renamed button is
  probably an edit.
- **Whether the five are the right five.** Repairing a tour nobody wants is
  worse than retiring it.
- **Relationship to the merge-time smoke tier.** That issue proposes a
  hard-fail gate at merge and post-deploy; this is the soft weekly instrument.
  They may share a walk definition, and should not become two divergent ones.

## Resolved 2026-08-26 (tour-health)

- All four tours walk clean (`browse-walk`, `capture`, `nav-pages`,
  `new-chat`); `dashboard` was folded into `nav-pages` as a per-page
  skeleton row — its click-through is what `bin/smoke` does at every merge.
  Locators take a RegExp so box content never enters one; every checkpoint
  also asserts `noPageErrors()`.
- `schedules/tour-check/` runs them weekly in its own worktree against the
  worktree's box clone. Its session **edits** a tour when a deliberate change
  (a landing, a plan, or an issue naming that change) explains a miss, and
  **files** everything else; it lands its own tour edits with `bin/land`.
- Shared with the smoke tier: `tour-lib/browse.ts` only. Different failure
  semantics, deliberately not one walk.
- Standing findings from the first walk are filed:
  `../bugs/2026-08-26-chat-load-logs-resumable-capture-list-error.md`,
  `../bugs/2026-08-26-questions-page-heading-order.md`,
  `../decisions/2026-08-26-axe-region-rule-on-floating-menus.md`.
