---
title: "`cb health` reports a procedure as failing when only its review step ran out of turns"
workstream: unattached
area: callback-box
labels: [health, procedures]
filed-by: agent
discovered-by: agent
discovered-in: main session — cb feedback triage from a real box
---

A scheduled `refresh-maps` run showed **failing** in `cb health`, but the work
itself had succeeded — the refresh step's own stdout said *"All MAP.md files
current."* The failure came from the **review/validate sub-step** hitting
*"Reached maximum number of turns (8)"* while trying to produce a verdict.

So the maps were fine and health said otherwise.

## Why it matters

Health reporting surfaces this **identically to a real content failure** — no
distinction between "the work failed" and "the checker couldn't finish deciding."
An agent reading health concludes the maps are stale and either redoes work
that's already done or, worse, treats a healthy box as broken.

That's a specific, costly confusion because the whole point of a validate step is
to be trusted: a checker that reports failure when it merely ran out of budget
teaches readers to discount the signal.

## What to separate

Three outcomes that currently collapse into one:

- **The step failed** — the work is genuinely wrong. Surface loudly, as today.
- **The check was inconclusive** — the validator hit its turn cap, timed out, or
  errored before reaching a verdict. The work may be fine; nobody knows. This
  should read as *unknown*, not *failing*.
- **The step passed.**

A turn-cap exhaustion is arguably a fourth thing again — it's a *budget* problem,
which points at either a cap set too low for the job or a validator prompt that
wanders. Worth recording which, since the fix differs.

## Related

Not the same as the retro/validate failure seen on the same procedure in the
weekly manual-test log (an instruction check that legitimately caught a
duplicated MAP entry, retried, and failed the step). That one was the machinery
working. This one is the machinery reporting a non-answer as an answer — same
procedure, opposite problem, and worth keeping distinct when investigating.
