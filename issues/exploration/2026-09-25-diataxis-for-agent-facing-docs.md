---
title: "Apply Diátaxis to our documentation, with agents as the main reader"
workstream: unattached
area: docs
labels: [docs, agent-guidance]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder impressed by diataxis.fr, 2026-09-25
---

The boxholder is impressed by the thoughtfulness of
[Diátaxis](https://diataxis.fr/) and wants to consider it for our
documentation. Almost all of our documentation is written for agents, so not
all of it may apply.

## Diátaxis in brief

Four kinds of documentation, chosen by what the reader needs. The
[compass](https://diataxis.fr/compass/) asks two questions: *action or
cognition?* and *acquisition or application?*

| | acquisition (learning) | application (working) |
|---|---|---|
| **action** | tutorial | how-to guide |
| **cognition** | explanation | reference |

Two ideas carry most of the value:

- **Do not mix kinds on one page.** Each kind has its own structure and tone,
  and a page that mixes them serves no reader well.
- **Adopt it iteratively**, one page at a time, not as a big restructure
  ([how to use Diátaxis](https://diataxis.fr/how-to-use-diataxis/)).

## Where it already touches us

The [doc-structure plan](../../beebox/docs/implemented-plans/doc-structure.md)
considered Diátaxis as prior art. It kept the existing split by document kind
in `beebox/docs/README.md` (flat reference, `design/` for why, `plans/`,
`reports/`). Within a reference doc it uses an aspect axis that maps onto
Diátaxis's how-to versus reference distinction as **headings, not files**. So
the plan absorbed part of the idea and set aside the rule against mixing kinds
in one page.

## How the four kinds map onto agent readers

A first reading, to test rather than assume:

- **Reference** is most of what an agent needs, looked up in the middle of a
  task: card types, the `bbx` command reference, the box-docs.
- **How-to** is procedure. Skills are already how-to guides, and so are parts
  of the agent guide.
- **Explanation** matters more for agents than it may seem. The "why" is what
  lets an agent make a judgment call instead of applying a rule literally
  (`docs/design/`, the reasoning in plans).
- **Tutorial** (learning by doing) barely applies to an agent. It applies to
  human onboarding: the architecture series, the public site, a newcomer's
  first days with a box.

Candidate surfaces where mixing is visible today: the always-loaded agent
guide (`beebox/src/core/agent-guide/`), which mixes reference, how-to and
rules in one document; skill files that carry explanation alongside procedure;
and CLAUDE.md files.

## Research (incomplete)

Questions to answer:

- Does "one kind per page" help an agent reader, or does an agent benefit from
  a rule and its reason sitting together? Rules usually come with a short why,
  and splitting them may cost the judgment the why supports.
- Is there a fifth need Diátaxis lacks for agents: **rules**, meaning always
  loaded constraints that are not reference, how-to, or explanation?
- Which surfaces should adopt the kinds as separate files, and which only as
  headings (the doc-structure plan's choice)?
- Pick one mixed page, split or relabel it by kind, and compare. A
  knowledge audit for box-facing guidance, or the doc-structure plan's
  find-the-fact walk for engine docs, can measure the difference.
