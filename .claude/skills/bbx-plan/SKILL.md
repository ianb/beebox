---
name: bbx-plan
description: Write or review an implementation plan for non-trivial work such as features, refactors, vocabulary or schema changes, and multi-track efforts.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, WebFetch, WebSearch
---

# /bbx-plan

A plan is a complete unit of work: designed end-to-end before implementation,
shipped end-to-end when it finishes. Writing one and reviewing one are the same
act — the template's blank sections are the failure modes you haven't thought
about yet, and filling them honestly IS the review.

## When to invoke

When the cost of an unsurfaced failure mode exceeds the cost of writing the
plan: a new schema or shared-vocabulary tag, a migration, a refactor across
more than one module or with a transition state, anything where "what happens
when the agent picks the wrong X" is a real question.

Skip it for one-file changes obvious from the diff, bug fixes where the fix is
the artifact, and exploratory spikes (spike first; plan if it survives).

## Writing a plan

1. Copy `TEMPLATE.md` (beside this file) to `beebox/docs/plans/<topic>.md`.
   Subplans: `<topic>.subplan.md`. Frontmatter per `docs/plans/README.md`:
   `status: draft`, the bare `workstream:` name (or `unattached`), and the
   `issues:` list — `/finish` reads that list to close issues, so grep the
   queue for related and duplicate items before you start.
2. Fill every section. Keep the headers verbatim. A section that genuinely
   doesn't apply says *why* ("no prior art: this is a new vocabulary surface"),
   never "N/A".
3. Write for a reader six months from now with no context — Simplified
   Technical English in spirit: short sentences, active voice, one idea per
   sentence, consistent terms. Not a chat transcript.

**Where the work happens.** Big plans run in a worktree; commit freely there.
The plan completes, then it ships as one piece — and **only when the boxholder
says so**. Committing chunks is normal; merging a partial plan because "the
first part feels done" is the violation. Long multi-track plans are fine when
their budget says so (see *Circuit breaker*); execute them serially in
dependency order, don't compress them.

## The discipline

These are what make a plan checkable rather than a story. They apply when
writing and when reviewing.

- **Cite, don't assert.** Any claim about existing code or behaviour quotes
  `file:line` plus verbatim text — including claims of safety ("Y handles this"
  cites where). "CLAUDE.md says to read before writing" is a paraphrase;
  `beebox/CLAUDE.md:101`: *"Read before writing…"* is a citation.
  "Probably" / "likely" / "I think" are guesses: verify or mark unverified.
- **Explain actual tradeoffs against stated preferences.** Cite the relevant
  human decision, engineering principle, repo rule, or shipped precedent when
  it informs the choice. Ordinary implementation choices need no principle
  mapping; do not invent a principle to justify them.
- **Two sections are gates, not prose.** *Could this be simpler?* — name the
  simplest version and what the fuller plan buys, per a principle; if you can't,
  shrink. *NOT in scope* — a plan touching more than one module, a transition
  state, or new vocabulary with an empty NOT-in-scope hasn't bounded itself.
  Neither is a size limit; they replace one.
- **No numeric scoring.** No confidence levels, completeness scores, or 1–10
  ratings. A finding that needs a number needs better prose.
- **Searches that came back empty are findings.** Prior art, the issue queue,
  the code: "searched for X, found nothing" is information; write it down.
- **Open questions live outside the first chunk.** A question inside the first
  implementation chunk is a missing decision — settle it in Direction.

## Circuit breaker

A plan is sized against the problem that prompted it, and work stops when it
outgrows that size. Stopping, stepping back to a smaller fix, or reverting are
normal outcomes, not failures.

**Set the budget while writing.** The template's *Smallest fix and budget*
section names the smallest change that fixes the problem as reported, and
this plan's budget: tracks, subprojects, and estimated lines of source and of
tests. Some plans exceed ~3× the smallest fix. Others add a subproject,
protocol, or vocabulary that the request did not ask for. Either kind goes to
the boxholder as a choice between the two before you write the rest.

**During implementation, compare like-for-like with the budget.** Count the
source/test categories it estimates; report documentation or generated output
separately unless the budget explicitly includes them. Do not silently raise a
budget to absorb growth.

**It trips when any of these holds:**
- the diff passes 1.5× the budgeted lines, or reaches a subproject or track
  the budget did not list;
- a state, protocol, or subsystem appears that the plan did not name;
- the boxholder asks why it is so big.

Before correcting the same mechanism again in response to implementation
findings, reassess whether the design still holds. Revision/review counts alone
are not stop conditions, and routine plan-text corrections need no reassessment.
Continue within the approved scope; stop if the findings invalidate the approach
or trip a gate above. Record changed decisions, not a ritual no-change report. The separate
`bbx-debug` three-failed-fix limit still applies during debugging.

**When it trips:**
1. Stop launching work and stop committing.
2. Write a short breaker report in the plan: what was asked, what is built,
   size against budget, what drove the growth.
3. Run a scope review with the other model family (`cross-model`, challenge
   mode). It classifies each built piece against the boxholder's own words as
   required, justified-but-optional, or scope creep, and names the smallest
   version that still meets the request. Use an existing review if it already
   answers this scope question at the current state. Respect `cross-model`'s
   two-round limit; after it, bring the scope decision to the human without
   inviting another fresh-findings pass.
4. Give the boxholder the options: stop and revert, step back to the smallest
   fix, salvage the required core, or continue under a new budget. Say what
   each option keeps and what it loses.

Resume only on their choice, and record the new budget in the plan.

## Reviewing an existing plan

Read the plan; check every template section is present and every claim cited.
For external prior art, verify the premises the design relies on; do not repeat
searches that have no bearing on a design decision.
Write findings to a sibling `<plan>.review.md`:

```
# Plan Engineering Review — <topic>
## What already exists
## Prior art (external) — verified      ← verify external premises the design depends on
## Stated preferences this plan trades against
## Could this be simpler? (verified)
## Failure modes
## Agent-flow / user-flow edge cases
## Findings
## NOT in scope (verified)
## Things I checked and found clean     ← "covered and fine" vs "didn't look"
```

One finding per item, never batched:

```
### <short title>
**Location in plan:** `path/to/plan.md:<line>` (or section)
**Citation:** verbatim quote from the plan or source
**Issue:** what's wrong, risky, or missing
**Why it matters:** the failure mode or burden
**Suggested action:** concrete next step
**Relevant preference:** name it when the finding concerns a stated preference or tradeoff; otherwise omit
```

A missing template section is itself a finding; flag it for the planner rather
than filling it in the review. A hand-wavy *Could this be simpler?* is a finding.
