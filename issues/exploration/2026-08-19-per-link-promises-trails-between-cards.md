---
title: "Links that promise something: frontmatter trails with a per-link \"what you will find\""
workstream: unattached
area: beebox
needs: [design]
labels: [cards, links, search, embeddings]
filed-by: agent
discovered-by: Ian
discovered-in: main session — after reading how Microcosm expressed links
priority: normal
---

A convention for cards to accumulate links to each other in frontmatter, where
each link carries a **promise about what the reader will find at the other
end**. The boxholder's sketch:

```yaml
trail:
  - ref: "..."
    relation: "..."
    what-you-will-find: >
      a description of what information, from the perspective of someone
      reading this, you will find in that document
```

## The unusual part, and why it matters

> The `what-you-will-find` is not a usual part of links (relation is usually
> much more formalized, and doesn't actually speak to utility), but is like a
> skill. In that it promises something about the other end of the link, so you
> can decide if you want to follow it.

Formalized link vocabularies say what *kind* of relationship holds. They never
say what you would get from following it. The only place this is routinely done
well is **academic prose**: the sentence around a citation — "see X, which shows
Y" — is written by the citer, from their vantage, about why *this* reader should
go. The abstract at the far end cannot do that job, because it does not know who
is asking.

Skill descriptions are the other instance, and the closer analogy: they exist so
a caller can decide whether to invoke, and they are written toward that
decision.

## The consequence for search and embeddings

> Also is a great way to think about search. and embeddings (we're halfway
> there, but the what-you-will-find is bound to the document, not the relation).

That is the sharp observation. Today a description or embedding belongs to the
document: one summary serving every possible reader. Bind it to the *relation*
and the same document carries different promises depending on who points at it
and why.

Which opens an index we do not have: embed the **promises**, not only the
documents. They are short, they are intent-shaped rather than content-shaped,
and matching a query against them is matching intent to intent. Relevance stops
being treated as intrinsic to a document and becomes relational, which is what
it actually is.

Worth testing against `bbx search` (Orama, full-text plus vector) rather than
assuming — the question is whether a promise-index complements the content
index or competes with it.

## The mechanism already exists; the convention does not

This is a discipline on machinery that is already mature, not a new subsystem:
`src/shared/ref-path.ts` (the three-form ref rule), `core/canonical-refs.ts` and
`canonicalize-refs.ts` (checking and rewriting), the `normalize-ref-keys`
migration that already moved bare-string refs onto a `ref` key, and ref repair on
move via `bbx mv` and `doc-check --fix`.

It also avoids the problem the Microcosm reading surfaced: these links are
**in-band** — legible by reading the card, no separate linkbase, and write access
is a non-issue because the box owns its cards. See
[collection views](../features/2026-08-19-collection-views-are-badly-defined.md)
for the out-of-band alternative and the trade.

## The boxholder's own worry, which is the main design question

> It does feel like it's inviting a lot of churn, and hard to set baseline
> expectations for what should become a trail and what shouldn't.

A candidate answer, worth testing rather than adopting: **the expensive field is
the quality gate.** If you cannot write a specific, non-generic promise, there is
no link worth making. "Related information" fails visibly in a way that
`related: [ref]` never does. That inverts the usual dynamic where adding a link
is cheaper than deciding whether it deserves to exist.

Two things follow if it holds:

- **Harvest, don't speculate.** Prefer links that record a relationship some
  piece of work actually used — a triage that filed this there, an answer drawn
  from that source — over links added because two things seem related.
- **A wrong promise costs more than a missing link**, because it spends a read.
  That argues for fewer and better, which is the opposite of churn.

Still unanswered: **who prunes.** A promise that stopped being true is worse than
no link, and nothing yet owns removal. Box growth is already a live concern; this
has the same shape.

## Naming

> I kind of like "trail" as a homage to the memex, though something important
> like this should be a better name than just an homage.

Agreed, and the two ideas in play want different words. *Trail* carries
accumulation-by-traffic — paths worn in by use. It says nothing about the
promise. **`leads`** carries the other half: you follow a lead because of what it
might yield, and the investigative sense is exactly the utility orientation the
formalized vocabularies lack.

`leads: [{ ref, relation, promise }]` reads honestly. Whether the field is
`promise`, `offers`, `expect`, or something else is open; `what-you-will-find`
was explicitly a placeholder.
