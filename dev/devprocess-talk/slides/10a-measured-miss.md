# The gate failed, and the plan said so
## Supporting: change-based test selection, the Track 0 measurement
```markdown
Then Track 0 measured it, and **the gate it set was not met**: 25% of real
branches are fully accounted for, against a bar of 50%.

The plan continues anyway, and the reason must be stated plainly rather than
buried, because "the gate failed, we proceeded" is exactly the shape of
motivated reasoning. **The gate was set for a project whose value was the
speedup.** The boxholder's response to the result reframed the project: if
three quarters of branches touch code no test imports, running 484 tests for
them is not verification, it is ritual — the honest description of a change to
untested code is *this code has no tests*, and a full suite does not fix that,
it hides it. What is actually unknown is whether those full runs ever catch
anything… So the deliverable became the instrument that can answer it.
```
- Ledger today: 1,217 selected runs, 414 fully accounted (34%)

Notes:
Path: beebox/docs/plans/change-based-test-selection.md. The planned "unaccounted path forces the full suite" rule was never shipped; after sixteen days of ledger data showed no case of a full run catching an unimplicated bug, an empty selection became the honest answer and the hourly suite took over main.
