---
title: Walkthrough prototype
summary: "Unlisted round-3 prototype: a morning with the box told through real user stories, with categorized asides in three voices."
unlisted: true
imported-from: store/site/walkthrough.site-page.card
---

# A morning with the box

> **[EDITORIAL PLACEHOLDER — prototype scaffold, not the boxholder's words.]**
> The narration below is demonstration text. The indented story cards are
> real: pulled verbatim, with provenance, from the verified user-story
> catalog in the repository. The emoji are stand-ins for character drawings.

## Mail arrives

Overnight, three emails landed. At seven the box wakes up and pulls them in —
each one becomes a card in the inbox, sitting next to everything else that
needs attention.

{% nugget slug="story-gmail-pull" /%}

{% aside kind="bee" label="the bee turns an envelope over, unsure how it got inside the box" %}
Nothing arrives by magic. A *connector* runs on each wakeup: it asks Gmail
"what changed since last time," and writes what it finds as plain files —
one card per thread, one per message. The box never sits inside your email;
it copies what it needs and works locally.
{% /aside %}

## The box sorts

Most of the morning mail is routine, and routine things should not wait for
a human. The box files what it recognizes and holds what it doesn't.

{% nugget slug="story-triage-confidence" /%}

{% aside kind="generated" label="what “confidence” means here" %}
The agent labels every routing decision *confident*, *probable*, or *guess*.
Confident items move to their folder. Probable items move too, but keep a
review marker so you can spot-check. A guess doesn't move at all — it stays
put and becomes a question instead. The threshold between acting and asking
is the whole design.
{% /aside %}

## It asks instead of guessing

One message fits nothing: an invoice from a company the box has never seen.
So it stops, writes a question card, and moves on. The question waits on the
dashboard until you answer it — and the answer teaches the box what to do
next time.

{% aside kind="author" label="why it asks instead of guessing" %}
> **[PLACEHOLDER — the author's words go here.]** This panel renders only
> the boxholder's own writing. Until that exists, it stays visibly empty —
> nothing here will be ghostwritten.
{% /aside %}

## Questions this page is asking

> **[Scaffold — reaction notes for the boxholder.]** Do the three voices
> read as distinct at a glance, or do the kinds need more than an emoji and
> a provenance line (typography shift for the machine voice? a hand-drawn
> frame for the author?)? Is the bee's stage-direction label the right
> wordless register? Does quoting user stories as cards work as the
> walkthrough's spine, or should the spine be an actual transcript with the
> stories as asides? Is the provenance footer ("generated from the
> repository" / "the author's words") the right weight?
