---
title: "Fisheye prototype"
summary: "Unlisted prototype of the expand-in-place (telescopic) presentation — Track F's taste checkpoint, linked from nowhere."
unlisted: true
---

# Fisheye prototype

> **[EDITORIAL PLACEHOLDER — prototype scaffold, not the boxholder's words.]**
> This page exists so the interaction can be judged on a real page instead of
> debated in prose. Every sentence here is demonstration text.

## Inline depth

Reading should feel like one sentence that happens to go deeper. This
paragraph carries a claim {% expand label="with a compressed reason" %}whose
fuller reason unfolds in place, inside the sentence you were already reading,
{% expand label="and can itself go deeper" %}because an unfolded clause may
carry its own compressed spot — {% expand label="one more level" %}this is the
third level down, where the wash is darkest and the question is whether you
still know where you are{% /expand %} — without leaving the page{% /expand %},
rather than jumping you to a footnote or another page{% /expand %}. The
collapsed text is still in the document, so find-in-page opens it where
supported, and the plain-markdown twin of this page carries everything flat.

## Block depth

A paragraph can also end at a threshold, with the deeper material behind a
plain fold rather than spliced into a sentence.

{% expand label="What the fold holds" %}
Block depth uses the browser's own disclosure element: no script, indented
one step behind a hairline, and it nests.

{% expand label="A second fold inside the first" %}
This is where a longer aside would live — a design rationale, a history, an
objection answered.
{% /expand %}
{% /expand %}

## The record, quoted

A fold can hold a *nugget*: a verbatim excerpt of the repository, with its
provenance attached, never paraphrased by the machine.

{% expand label="Why the representation matters" %}
{% nugget slug="representation-mirrors-the-idea" /%}
{% /expand %}

## Questions this page is asking

> **[Scaffold — reaction notes for the boxholder.]** Does the dotted
> underline read as "this goes deeper" without explanation? Is the wash the
> right depth cue, or should depth read some other way (indent, rule,
> typeface)? Is mid-sentence splicing pleasant or disorienting at level
> three? Should the trigger text stay visible once opened, or be absorbed
> into the revealed text? Does the block fold's summary line want to read as
> prose or as apparatus?
