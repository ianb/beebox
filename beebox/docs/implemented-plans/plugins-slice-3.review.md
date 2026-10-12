---
title: "Plugins slice 3: plan review record"
status: implemented
workstream: plugins-planning
issues: []
---
# Plan review — plugins slice 3

Cross-model plan review by codex gpt-6-sol, 2026-10-11, prompt
`scratch/cross-model/plugins-slice-3.plan.prompt.md`. Four findings,
adjudicated by the planner.

## Findings and adjudication

### The medium/content line applied too broadly
**Reviewer:** the line protects taking material in; it does not decide that
every source-specific integration is medium, and the design notes separate
core formats from the connectors that fill them.
**Adjudication:** accepted in part. The plan now states the narrower claim
(these three are the only intake for mail, calendar and drive) and grounds
"medium" in the measured coupling (shared auth, admin flow, scheduler
alerts, default schedules, 54 engine imports) rather than the slogan. The
decision is presented as three shapes for the boxholder; the plan's lean is
unchanged.

### A smaller shape with a user-visible result was missed
**Reviewer:** declarative connector IDs on plugin definitions, resolved
through the existing registry, with a single activation rule.
**Adjudication:** accepted. Written up as shape B with its gain (one list
of what is on in a box) and its cost (hook, policy switch retired, admin
writer, a box.json migration on every box, eight docs). The plan says why
the lean stays A: the gain is a listing that `bbx status` and the Google
and connector-activity health checks already give piecewise.

### The sizing mixed a wrong count with an unhelpful metric
**Reviewer:** connector directories total 10,149 lines, not 9,679; 45
distinct outside modules, not "about 30"; the frontend figure had no file
list; a move counted twice describes diff volume, not effort.
**Adjudication:** accepted. Recounted: 10,149 lines; 55 distinct outside
specifiers, one allowed; the ten frontend files listed with their 1,487
total. The plan now separates the cheap rename from the real work (54
re-routed imports, the export surface, two hook kinds).

### Track 3 leaves the visible false claims
**Reviewer:** the generated connector docs table emits its own "Produces"
list, wrong for Gmail ("via IMAP"), Drive (omits gfolder, glink) and
Telegram (`telegram-message` vs `chat-thread`).
**Adjudication:** accepted. Track 3 now corrects the table and regenerates
`box-docs/connectors.md`; the remaining drift risk is in Failure modes with
its reason.

## Reviewer's single most important change
Compare against a one-connector declarative slice before closing the
decision. Done as shape B; the comparison is in Smallest fix and budget and
Open design questions.

## Round 2 (codex gpt-6-sol, 2026-10-11)

Findings 1, 2 and 4 confirmed addressed. Residuals, both fixed in the plan:
the outside-import figure was still a specifier count (55/54); resolved to
modules across the 56 connector files it is 45 distinct, 44 outside the
allowed surface, and the plan now says how it was counted. Shape B's gain
was overstated as "what is on in this box"; it is a listing of activated
connector plugins, and activation is not a connected or synced state. Its
named work was short of its estimate; the twelve `googleServices` readers
are now listed and the estimate is 500 source and 150 test lines. Track 3's
Telegram line keeps the incoming `chat-thread` and outbound
`telegram-message` distinction. No round 3: the residuals are counts and
wording the planner verified by command.
