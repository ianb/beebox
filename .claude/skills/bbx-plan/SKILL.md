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
their scope warrants it (see *Size and scope review*); execute them serially in
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

## Size and scope review

Estimates create pressure to keep the design small. They are goals, not automatic
cutoffs, and an agent's estimate is not a limit imposed by the boxholder.

**Estimate while planning.** In *Smallest fix and budget*, name the smallest
change that fixes the reported problem, the chosen tracks/subprojects, and
estimated source and test lines. Explain what the fuller approach buys.
Compare like-for-like during implementation: additions plus deletions, not net
growth. Report documentation and generated output separately so the size is clear.

**Over 2,000 changed lines is a BIG CHANGE.** Label it **BIG CHANGE**, explain
what drives the size, and obtain the boxholder's approval before proceeding at
that scale. Count the full proposed change, including source, tests, and authored
documentation; identify generated output separately rather than concealing it.
If that size and scope are already approved, continue without asking again.

When work grows substantially, show the revised estimate and check whether the
design still earns its size. Use cross-model scope review when it would help
identify unnecessary machinery. An estimate overrun, a ratio such as 1.5×, or
being asked why work is large does not itself require stopping or reverting.
Keep progressing within approved scope while making the cost visible. Ask for
a decision when the work becomes a BIG CHANGE without approval, introduces
materially different scope, or a finding invalidates the chosen approach.

Record the resulting decision in the plan. Honor an explicit human size limit;
do not reinterpret it as aspirational. The separate `bbx-debug` three-failed-fix
limit still applies during debugging.

## Reviewing an existing plan

Read the plan; check every template section is present and every claim cited.
For external prior art, verify the premises the design relies on; do not repeat
searches that have no bearing on a design decision.
Write findings to a sibling `<plan>.review.md`:

```
# Plan Engineering Review — <topic>
## What already exists
## Ontology (verified against the code's own names)
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
