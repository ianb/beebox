---
title: "Split plans into phases: requirements first, then implementation"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder request
---

A plan written with the bbx-plan skill is one unified document. The template
(`.claude/skills/bbx-plan/TEMPLATE.md`) puts the job and scope (intro, *Smallest
fix and budget*, *NOT in scope*) in the same pass as the design (*Ontology*,
*Tracks / scope*, *Failure modes*, *Implementation order*, *Rollout shape*). The
boxholder wants to consider two phases instead:

1. **Requirements.** What the change must do and why: the job, the observable
   behavior, the scope boundary, and the acceptance conditions. The boxholder
   agrees to this before any design work.
2. **Implementation.** How to do it: architecture, tracks, failure modes, order,
   rollout. Written against the agreed requirements.

## Why it is not obvious

- **What the split buys.** A separate requirements phase lets the boxholder
  correct scope before an agent invests in design. It also gives `/finish` an
  explicit list to check. Today the scope-delivery check (step 5b in
  `.claude/agents/finish.md`) extracts requirements from prose; see
  [the delivered-gate issue](../closed/features/2026-07-30-requirements-delivered-gate.md).
- **What it costs.** One more approval round for every plan. For small plans,
  two documents or two passes may be more process than the work needs. A
  threshold (or an optional phase) may be necessary.
- **Where requirements live.** Options: a section at the top of the same plan
  that gets approved first, a separate file, or a durable spec that outlives
  the plan (the OpenSpec model, where requirements merge into standing specs).
  The [OpenSpec comparison](2026-09-16-openspec-vs-bbx-plan.md) already maps
  their `proposal.md` onto the plan intro and scope sections, and notes that an
  explicit requirement list would help `/finish`.
- **Interaction with existing sections.** *Smallest fix and budget* and
  *NOT in scope* are requirements-phase material. *Could this be simpler?* and
  *Stated preferences this plan trades against* sit between the phases.
- **Review.** The plan-review format in the bbx-plan skill and cross-model
  review would need a requirements-only mode.

Related: [ontology-first planning](../closed/exploration/2026-09-17-ontology-first-planning.md),
which also proposed an earlier phase before architecture.
