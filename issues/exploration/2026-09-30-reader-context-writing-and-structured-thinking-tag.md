---
title: "Adopt reader-context writing, and a hidden Markdoc tag for saved structured thinking"
workstream: unattached
area: beebox
labels: [agent-workflow, writing]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder shared the reader-context-writing repository
---

**Credit:** [reader-context-writing](https://github.com/yaniv256/reader-context-writing)
by Yaniv Ben-Ami (MIT, 2026). Whatever this issue produces must carry that
credit. See *Where credit lives* below.

## The source

reader-context-writing is a skill for drafting and revising substantial prose
for its eventual reader, not for the session that produced it. Its central
mechanism is an annotated editing source:

- The author edits `<stem>.readercontext.md`, never the clean file.
- The annotated source holds the complete clean document plus
  `READER CONTEXT SIDECAR` blocks, in HTML comments, between passages.
- A renderer strips the blocks to produce the clean file. A checker proves the
  stripped source equals the clean file byte for byte.

Each sidecar block models the reader at that point in the document:

```
<!--
READER CONTEXT SIDECAR
Reader model: …          (what the reader knows by now)
Does not know: …
Cares about: …
Does not care about: …
Reader voice: "…"        (the question the reader is asking here)
Unresolved: …
Next passage: …          (what the next passage must do)
Do not assume: …
-->
```

The skill also has ideas beyond the sidecar: a "survival budget" (no top-level
section may lose half its readers), a conversation-leakage pass that removes
session rationale from the document, a named failure-mode registry (writing to
the user's latest objection, carrying correction rationale into the text,
switching audiences midstream, defensive hedges, and others), and
whole-document revision in place of local patches.

## The idea for Bee Box

**A Markdoc tag for saved structured thinking.** The sidecar is one kind of
structured thinking that an agent saves beside prose. Other kinds are likely:
a plan's developer-only notes, a decision's considered alternatives, an
argument map. Instead of one tag per kind, one generic tag:

- It is never displayed in the rendered card. The source view shows it, and an
  agent reading the file sees it.
- An attribute names the structure it applies, for example
  `{% thinking structure="reader-context" %}…{% /thinking %}`. The tag name is
  open; `thinking` collides with model "thinking" vocabulary.
- A structure can have a documented field set (the eight sidecar fields above),
  so an agent knows how to fill it and a linter can check it.

Compared with the source's HTML comments, a tag is validated by the card's
Markdoc config (`beebox/src/shared/markdoc-config/core.ts`, the `tags:` map),
can carry typed attributes, and is visible to the box's tooling. Strip-on-render
replaces the separate clean file: the card is the one file, and display is the
projection.

## Open questions

- **Where it applies.** Box agents writing `.doc.card` prose for the
  boxholder? Published pages (`_publish/`), where stripping must be certain?
  Dev-side documents (plans, docs, skills)? Dev-side files are not cards, so a
  Markdoc tag does not apply there directly. Note: an HTML comment in a
  SKILL.md reaches the agent unstripped (checked 2026-09-30), so the source's
  comment form would cost tokens in skills.
- **Who reads the hidden content.** Every later agent editing the card reads it,
  which is the point. Does any other reader (search index, `contains:`
  generation, retro) read it, or ignore it?
- **Staleness.** The source treats stale reader comments as a named failure
  mode. A hidden block that drifts from the prose it annotates misleads the
  next editor. What keeps it current?
- **Which structures to define first,** and whether reader-context is worth
  the cost on short cards.
- **Which of the skill's other ideas** (survival budget, leakage pass,
  failure-mode registry) belong in box agent guidance, dev-side writing
  guidance, or neither.

## Where credit lives

Tracked in [the attribution issue](../docs-and-chores/2026-09-30-attribution-for-adopted-ideas.md).

Related: [plan template has no developer-only section](2026-09-21-plan-template-no-developer-only-section.md),
another case of notes meant for the author and not the reader.
