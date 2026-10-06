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

### Hacker News discussion (read 2026-09-25)

Sources: [December 2024 thread](https://news.ycombinator.com/item?id=42325011)
and [a 2026 thread](https://news.ycombinator.com/item?id=49138188). The
substantive points, with generic praise and complaints left out:

- **Tutorial versus how-to is the fuzzy boundary.** The author (DanieleProcida)
  says his own teams argue about which is which. The clarification that holds
  up: a tutorial uses a contrived example for learning, and a how-to is a real
  task. This is the boundary least relevant to us, since tutorials barely
  apply to agents.
- **Applied literally, it hurts.** One report: a colleague allowed "not a single
  sentence of explanation in any tutorial". Another: a docs page with "literally
  only these four categories" never works. The consensus is that it succeeds as
  a thinking tool and fails as dogma. This bears on the rule-and-its-reason
  question below.
- **Repetition across kinds creates drift** (smeej). Readers are helped when
  the same fact appears in several kinds, but updates miss some copies.
  Diátaxis says what to write, not how to keep copies consistent. This matches
  the doc-structure plan's one-home-per-fact rule.
- **Link one way, toward reference** (CompoundEyes, who runs agents with
  Diátaxis guidance): how-to and explanation pages link to the reference page
  that holds a fact instead of restating it. That keeps the docs DRY. It is a
  concrete rule we could adopt.
- **Don't bury the reference.** Restructuring into categories can add clicks
  before the API docs people need most (rjmill: "Do not hide those from me").
  For agents, the equivalent is a longer path to the fact.
- **Structure alone is not enough.** The team that reported docs "on a whole
  other level" also had page ownership and periodic reviews (agile-gift0262).
- **LLMs already know it.** Several people report that telling a model "do
  diataxis" gives a decent first draft, so the vocabulary costs nothing to
  teach an agent.
- **Adjacent frameworks named:** DITA topic types (task, reference, concept),
  and *Every Page Is Page One* for pages that must stand alone. The second
  matches how agents arrive at a doc: from a pointer, mid-task, with no
  surrounding context.

### Questions still open

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
