---
name: bbx-plan
description: Write or review an implementation plan for non-trivial work such as features, refactors, vocabulary or schema changes, and multi-track efforts.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, WebFetch, WebSearch
---

# /bbx-plan

A plan is a complete unit of work: designed end-to-end before implementation,
shipped end-to-end when it finishes. Writing and reviewing use the same
template: a blank section is a failure mode nobody has looked at yet.

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
   `issues:` list — the finish skill reads that list to close issues, so grep the
   queue for related and duplicate items before you start.
2. Work that changes what a person meets (card type, surface, proactive or
   chat behavior, notification, onboarding, a record a person reads) gets its
   Design section from the bbx-design skill before the tracks. Other work
   writes "No design section: <reason>" under that heading.
3. Fill every section. Keep the headers verbatim. A section that genuinely
   doesn't apply says *why* ("no prior art: this is a new vocabulary surface"),
   never "N/A".
4. Write for a reader six months from now with no context — Simplified
   Technical English in spirit: short sentences, active voice, one idea per
   sentence, consistent terms. Not a chat transcript.
5. Run the cross-model plan review and adjudicate it before you write code;
   do not implement while it runs.
   When a review round or the boxholder reverses a decision, or you revise the
   plan after commits, search the plan for the old wording and rewrite every
   place it appears: the next reviewer reads the plan as authority.
6. Then write a CODING_FEEDBACK entry: pipe your answers to its four prompts
   (`bin/coding-feedback help` lists them) into
   `bin/coding-feedback add --checkpoint plan-reviewed`.

**Where the work happens.** Big plans run in a worktree; commit freely there.
The plan ships as one piece, and **only when the boxholder says so**: merging a
partial plan because "the first part feels done" is the violation. Execute a
long multi-track plan serially in dependency order; don't compress it.

## The discipline

These are what make a plan checkable rather than a story. They apply when
writing and when reviewing.

- **Cite, and prove the whole claim.** Any claim about existing code or
  behaviour quotes `file:line` plus verbatim text. The quote proves that the
  text exists. It does not prove "every", "none", "the same as", "reusable
  as-is", what the code does when it runs, or that a value reaches its
  consumer; the template's *Depends on* bullet names the evidence each of
  those needs. A subagent summary, handoff, issue, older plan, doc, or code
  comment is a lead: get the evidence yourself or mark the claim UNVERIFIED.
- **Searches that came back empty are findings.** "Searched for X in Y, found
  nothing" is the evidence for "none"; write it down.
- **No numeric scoring.** No confidence levels, completeness scores, or 1–10
  ratings. A finding that needs a number needs better prose.
- **Walk each user scenario before calling the plan ready.** Trace it hop by
  hop against the real code: who writes what, which process runs, what the
  person sees, what is left behind. Walk the way out as well as the way in
  (the thing ends, is deleted, clears), and write the walk in the plan. When
  the plan depends on an external model or API, call it with realistic data.

## Size and scope review

Estimates create pressure to keep the design small. They are goals, not automatic
cutoffs, and an agent's estimate is not a limit imposed by the boxholder.

**Estimate while planning**, in *Smallest fix and budget*. During
implementation compare like-for-like: additions plus deletions, not net growth.
Give source and tests, authored documentation, and generated output as three
figures. Leave the plan file and its review artifacts out of every figure.

**Over 2,000 changed lines is a BIG CHANGE.** Source, tests, and authored
documentation count; generated output does not. Label it **BIG CHANGE**,
explain what drives the size, and obtain the boxholder's approval before
proceeding at that scale, unless that size and scope are already approved.

When work grows substantially, show the revised estimate and check whether the
design still earns its size. Use cross-model scope review when it would help
identify unnecessary machinery. An estimate overrun, a ratio such as 1.5×, or
being asked why work is large does not itself require stopping or reverting.
Keep progressing within approved scope while making the cost visible. Ask for
a decision when the work becomes a BIG CHANGE without approval, introduces
materially different scope, or a finding invalidates the chosen approach.

Record the resulting decision in the plan. Honor an explicit human size limit;
do not reinterpret it as aspirational.

## Reviewing an existing plan

Read the plan; check every template section is present and every claim cited.
Re-derive each track's *Depends on* facts instead of trusting them: widen the
search, follow a flow one hop past where the plan stops, run the command.
A failure no real input reaches is not a finding (engineering principle 6).
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
