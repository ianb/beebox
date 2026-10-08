---
title: "Criteria for removing tests that have never failed and guard nothing a model gets wrong"
workstream: test-cleanup
area: beebox
labels: [tests, code-quality]
filed-by: agent
discovered-by: Ian
discovered-in: skills-review — "I trust the agents to generally write correct logic" (2026-10-08)
---

About 440 of 795 doctest files have never failed in 855 hourly full-suite
runs since 2026-08-25, and the suite grows at 0.53 test lines per src
line. The boxholder's position: agents generally write correct logic, so a
test that only re-proves straight-line logic is not earning its place.
Never having failed is context, not a criterion by itself: a test on code
that changed since it was written did its job quietly.

Proposed criteria, each on its own enough to remove an example (not a
whole file unless every example matches):

1. **Restates the code.** The assertion is the literal the code returns
   with no branch between input and output; deleting the code would be the
   only way to fail it.
2. **Second proof of one claim.** Another example in the same file proves
   the same branch with a different literal.
3. **Straight-line code, never changed, never failed.** The covered
   function has no branch, loop, parser, money, or security concern; the
   file has not changed since the test was written; the test never failed.
4. **Tests the framework.** Asserts that zod, Fastify, tRPC, or the
   doctest runner behaves as documented rather than that our code does.
5. **Mirrors a type.** The assertion is already enforced by the type
   checker (a required field exists, a union member is accepted).

Keep regardless of the above: anything on a trust or privacy boundary,
migrations, routes that accept external input, the Laws, and any test that
has failed on its own (see the flake issue, which runs first).

Procedure: a sweep in the knip-sweep shape (`schedules/`), reporting
candidates by criterion with a deletion branch judged on what it removes;
the first pass is read by the boxholder before it lands, later passes land
through cross-model review like the retrospective. Run after the flake
issue so the keep list is stable. Numbers go in the digest so the ratio is
visible going down.

## Agreed criteria (2026-10-08)

A sample of 64 never-failed files (454 examples) found C3 and C5 remove
almost nothing, so they are dropped. The sweep applies, per assertion: C1
restates the code; C2 second proof of one claim, within a file or across
files (the copy outside the code's home goes); C4 tests the framework. The
keep list above stands, plus cross-system contracts (mobile and scan wire
contracts, `beebox/*` package exports) and the files that have failed on
their own. The sample put this at about 5k of 145k test lines.

## Further trims to consider

Ideas outside the agreed criteria, collected during the sweep for a later
decision:

- (filled in per batch)
