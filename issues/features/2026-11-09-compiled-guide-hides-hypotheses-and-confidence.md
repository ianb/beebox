---
title: "A compiled guide drops hypothesis-level beliefs and hides confidence, so a guide is a weak model of anything still being learned"
workstream: unattached
area: beebox
labels: [guides, agent-context]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Guides_For_Learner_Models (general guide parts only), 2026-11-09"
---

A box agent used a custom `_config/*.guide.card` as a model of how a person
learns: beliefs with a confidence ladder, a basis, and experiments. Adding a
custom guide was easy; any `_config/*.guide.card` is picked up and listed in
the agent guide. Several parts of the guide card did not fit a model that is
mostly unconfirmed.

## Observations

- **Hypotheses vanish from agent context.** `compileGuide` skips rules at
  `confidence: hypothesis` (`beebox/src/schemas/guide/compile.tsx:26-29`).
  This suits triage. In a new model nearly every belief is a hypothesis: the
  compiled guide showed three of eight. The agent moved the hypotheses into
  `experiments`, which do compile.
- **Confidence and basis are not shown.** A compiled rule reads the same at
  `low`/`inferred` and at `confirmed`/`user-stated`.
- **Custom guides are not documented as welcome.** The boxholder assumed only
  the stock guides could exist. `bbx create -t guide` lists a `custom`
  domain, which is easy to miss.
- **Naming.** `triage-rules` is the only belief list. Outside triage the
  entries are beliefs.
- **Placement and prose.** A guide must sit at the root of `_config/` and has
  no body (`beebox/src/schemas/guide/schema.tsx:2`). A model about one
  subject would sit beside that subject's material with a few paragraphs of
  overview. Briefing cards have the prose and placement but no belief fields.
- **Quotes.** Context notes are plain strings, so the person's words lose the
  `{% quote %}` provenance markup the box requires elsewhere.

## Directions

- Let a guide opt in to compiling hypotheses, for example under an
  "Untested ideas" heading, and show confidence and basis.
- Or a sibling card type that shares the ladder, basis, and experiments and
  compiles into the context of its directory, like a briefing.

Related: [hypothesis tracking](../exploration/2026-05-19-hypothesis-tracking.md),
[guide cards inbox triage](2026-05-27-guide-cards-inbox-triage.md).
