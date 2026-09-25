---
title: "Three things to take from Karpathy's \"LLM Wiki\", and one open question about ingest"
workstream: unattached
area: beebox
needs: [decision]
labels: [knowledge, intake, provenance]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared the gist
---

[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
is an idea file for a coding agent. An agent maintains a markdown wiki from a
set of immutable raw sources. The person chooses sources and asks questions.
The claim is that synthesis done once at ingest compounds, and retrieval at
query time does not.

Most of the pattern is parity with a box, and in three places a box is ahead:
connectors beat drop-a-file ingest, typed cards beat freeform pages, and git
history with trailers beats an append-only log an agent maintains by hand.
This issue keeps only what survived a check against the code (2026-09-17) and
drops the comparison table that made up the first version.

## Take: contradiction and supersession as a recorded state

When a new source disagrees with a claim already on a card, the card should
say so and cite both, rather than one claim silently replacing the other.

Verified absent. The concept does not exist anywhere in `beebox/src/`; every
"stale" match is about GPS fixes or template updates. The nearest relative is
`personality` beliefs, which carry `source: user-stated | inferred`
(`beebox/src/schemas/personality.tsx`) — belief revision in one narrow place.

This is the item with the most weight for this box, because its subject matter
is people and plans, where facts expire. Today a superseded claim survives
only in git, where nothing reads it.

## Take: provenance on entity cards

`record` cards carry `sources: [{ref | href, time?, note?}]`
(`beebox/src/schemas/record.tsx`). `person` and `place` carry nothing, so a
claim on a person card cannot be traced to what produced it. The optional
`{% source %}` Markdoc tag is prose, not a queryable field.

This is the prerequisite for the item above: without knowing which source a
claim came from, nothing can mark it superseded when a newer source lands.
Note that `contains-evidence` is not this — per its docblock it shows the work
behind the card's own `contains:` summary, not where the card's content came
from.

## Take: gap-finding as a proposal, not a check

A periodic pass that reports concepts appearing across many cards with no card
of their own, and cards nothing links to.

The orphan half is cheap: `findInboundCardRefs`
(`beebox/src/core/find-inbound-card-refs.ts`) already backs a "referenced by"
panel and a pre-delete warning, and no lint uses it. The concept half is the
valuable half, and structural lint could never grow into it: card lint checks
schemas, ref existence, path forms, and Markdoc
(`beebox/src/core/card-lint.ts`), all of which ask whether a card is
well-formed, never whether the box is missing one.

Output is a proposal for the boxholder, not a validation failure.

## Open question: how much synthesis happens at ingest, unsupervised

The gist has one source touch ten to fifteen pages at ingest. A box files the
source and stops: intake normalizes filenames and moves files
(`beebox/src/core/intake.ts`), triage routes or asks
(`beebox/src/core/triage/routing.ts`), and nothing opens a second card to add
what the source said. This is the pattern's load-bearing behavior and the
place where the two designs actually differ. It needs a decision, and it is
genuinely two-sided.

**For doing it at ingest.** Deferring synthesis to whenever someone asks is
retrieval with extra steps, which is the thing the pattern exists to avoid;
knowledge never compounds. A box already does plenty of unsupervised agent
work — triage classifies, connectors sync, procedures run on a schedule — and
updating a person card is not categorically different from filing a page into
a category. Every write is a commit, so a bad update is visible and
revertable. Waiting for the boxholder to ask is the same failure as a
standing task nobody remembers to run.

**Against.** Ten to fifteen agent-decided writes per source is real write
amplification, and each one edits a card whose full context the agent cannot
see. It automates judgment rather than arranging context. A card that accretes
automatic edits from every passing mention can get worse over time rather
than better, and nobody is reading it to notice.

**The middle path, and probably the answer.** Ingest proposes the updates and
they land somewhere reviewable, which is an idiom this box already has in
several forms: a question card, a parked template update, a batch waiting in
an inbox. The contradiction item above needs a surface like this regardless,
so the two decisions collapse into one.

## The line worth stealing

The gist's division of labor is this box's stated preference, stated more
crisply than its own guidance puts it: the person curates sources, directs the
analysis, asks the questions, and decides what it all means; the agent does
everything else, because the tedious part of a knowledge base is the
bookkeeping rather than the reading or the thinking. Worth adapting into box
guidance whatever happens to the rest of this issue.

## Corrections to the first version of this issue

- It claimed place cards do not exist. They do
  (`beebox/src/schemas/place.tsx`, registered). Only a topic or concept card
  type is genuinely missing, and `concept-map` is a different thing: one card
  holding a whole courseware graph, with concepts as in-card nodes.
- It pointed at [backlinks surface](../features/2026-05-11-backlinks-surface.md)
  as related work. That issue cites `cardworks` and two functions that no
  longer exist, and the card panel and pre-delete warning it asks for have
  since shipped. It needs rewriting or closing on its own account.
- Dropped as parity, to stop them being re-litigated: schema file, git-backed
  store, per-directory `MAP.md`, connector ingest, the Law of Saving, and box
  search. Also dropped: a flat append-only log, which the History card covers
  well enough; and "the agent proposes what to read next", which is
  [/spark mode](../features/2026-05-19-spark-mode.md).

## Still open

The gist scopes itself to roughly a hundred sources and a few hundred pages,
and says dedicated search tooling becomes advisable past that. Production
boxes are larger. Nothing here depends on the index-file approach, but any
future "read the index first" design does, and that question stays open.
