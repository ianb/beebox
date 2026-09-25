---
title: "Try ontology-first planning: ask the planner for a strong ontology before the architecture"
workstream: unattached
area: beebox
resolution: implemented
labels: [planning, agents, bbx-plan]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a skeet the boxholder wants to test here
---

> **Adopted 2026-09-21 without the trial.** The boxholder: "I'd like to add
> [this] to the bbx-plan skill. Probably a template section?" So the A/B
> comparison below was not run — the step is now an **Ontology** section in
> `.claude/skills/bbx-plan/TEMPLATE.md`, between *Prior art (external)* and
> *Tracks / scope*, and a matching heading in the reviewer's section list in
> `SKILL.md`. What was not done: the cross-model reviewer prompt
> (`.claude/skills/cross-model/SKILL.md`) still says nothing about checking a
> plan's ontology against the code's, and no evidence was gathered that the
> step improves a plan. If the next few plans show it is noise, remove it —
> this closed on a decision, not a measurement.

A skeet the boxholder saw, quoted as posted:

> Wow. Telling Astra to consider/make a strong 'Ontology' really does juice
> its ability to plan a sensible architecture. I forgot who mentioned this
> before but thank you!

The claim: asking the planning model to write down the ontology first (the
things in the problem, what each one is, how they relate, what is one thing
versus two) produces a better architecture than asking for the architecture
directly. It is plausible on the face of it: most of this repo's plan
reviews find vocabulary problems (two names for one thing, one field doing
two jobs, a state that cannot be represented), and those are ontology
mistakes that surface late, at implementation.

## What to try

Pick one upcoming plan of ordinary size and run the planning step twice:

1. As `bbx-plan` does it today.
2. With one added step before **Tracks / scope**: "Write the ontology.
   List every noun the design needs, one line each: what it is, what
   identifies it, what it is not, and which other nouns it points at. Mark
   which ones already exist in the codebase and where. Then write the
   architecture in those terms only."

Compare the two on the things that usually go wrong: invented concepts the
codebase already had, fields with two meanings, states that later needed a
migration, and how many review findings each draft draws. Use a different
model family for the review so the comparison is not the planner grading
itself.

A good first candidate is any plan that introduces a card type or a
shared-vocabulary tag; those are where the ontology is the design.

## If it works

Fold the step into `.claude/skills/bbx-plan/TEMPLATE.md` as a section between
**What already exists** and **Tracks / scope**, and into the reviewer prompt
in `.claude/skills/cross-model/SKILL.md` as a thing to verify ("does the
plan's ontology match the code's?"). Keep it a section, not a separate
document; it is the part of a plan that names things.

## If it does not

Record the comparison here and close as `invalid`. One trial is a signal,
not a verdict; two plans in a row with no difference is enough to stop.
