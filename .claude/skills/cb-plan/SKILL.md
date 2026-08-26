---
name: cb-plan
description: Use when the human wants to write a plan for non-trivial work — a new feature, a refactor, a vocabulary or schema change, a multi-track effort — or to review an existing plan. Triggers include "write a plan", "make a plan for X", "let's plan", "review this plan", "/cb-plan".
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, WebFetch, WebSearch
---

# /cb-plan

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

1. Copy `TEMPLATE.md` (beside this file) to `callback-box/docs/plans/<topic>.md`.
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
first part feels done" is the violation. Long multi-track plans are fine and
often right; execute them serially in dependency order, don't compress them.

## The discipline

These are what make a plan checkable rather than a story. They apply when
writing and when reviewing.

- **Cite, don't assert.** Any claim about existing code or behaviour quotes
  `file:line` plus verbatim text — including claims of safety ("Y handles this"
  cites where). "CLAUDE.md says to read before writing" is a paraphrase;
  `callback-box/CLAUDE.md:101`: *"Read before writing…"* is a citation.
  "Probably" / "likely" / "I think" are guesses: verify or mark unverified.
- **Trace every choice to a stated preference** — a numbered principle in
  `docs/engineering-principles.md`, a CLAUDE.md or code-style rule, or the most
  recent shipped precedent. A choice that can't be traced means either a weak
  choice or a missing principle; both are worth saying.
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

## Reviewing an existing plan

Read the plan; check every template section is present and every claim cited.
Write findings to a sibling `<plan>.review.md`:

```
# Plan Engineering Review — <topic>
## What already exists
## Prior art (external) — verified      ← redo the planner's search; confirm or contradict
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
**Traces to preference:** one sentence naming the principle
```

A missing template section is itself a finding; flag it for the planner rather
than filling it in the review. A hand-wavy *Could this be simpler?* is a finding.
