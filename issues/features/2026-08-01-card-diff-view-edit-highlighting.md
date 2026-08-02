---
title: "Card diff view: highlight what changed as a card is edited (control during voice/chat editing)"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder wants to see what the AI actually edited
---

A mode or toggle on a card that **highlights the diff as the card changes** — so
when the boxholder directs an edit ("change this to that"), they can see exactly
what the AI did, not just be told it happened. The driving case is the **editing
process**, especially when the boxholder is directing by **voice or chat** rather
than typing in an editor.

## Job to be done

When the boxholder tells the AI to edit a card ("change this to that") by voice or
chat, they want to **see exactly what it changed**, so they keep real control over
their own content instead of trusting an edit they cannot see. Situate it: they
have delegated the *mechanics* of the edit (they are talking, not typing) but not
the *judgment* — they still own the content. Re-reading the whole card to spot what
moved is exactly the friction that erodes that control, so the change has to be
**surfaced and highlighted**, not left for the eye to find. The control also has to
be **real, not reassurance theater**: the diff must faithfully show the true
before/after (and ideally be reversible), or it gives false confidence — the
boxholder said "actual control, hopefully."

## Scope is deliberately open

The boxholder is explicit that this need not be all-or-nothing:

- It **might only work for markdown bodies** — a text diff of the body is the
  obvious, high-value case.
- It **could be done more completely** — frontmatter / structured fields, not just
  the body.
- **Not everything has to support a diff view.** Partial coverage is acceptable;
  media/binary content may simply opt out. Start with the markdown body and expand
  only where it pays off.

## Design questions

- **What is the "before"?** A diff needs a baseline. Diff against what — a snapshot
  pinned at the start of the editing turn/session, or the card's existing version
  history? The baseline must survive until the boxholder reviews it, since with
  voice/chat the edit and the review can be **asynchronous** (say it, then look).
- **Rendering per content type.** Markdown body → inline text diff (added / removed,
  the strikethrough-old + inserted-new style — see the ProofEditor screenshot that
  inspired [questions-as-inline-annotations](../exploration/2026-08-01-questions-as-inline-annotations.md)).
  Structured fields → a field-level diff. Media → likely unsupported.
- **Toggle/mode vs. always-on-while-editing.** Is it a view the boxholder switches
  on (a `?view=diff` on the card's `browse/` path, per the card-attached-view
  model), or does it appear automatically after an AI edit?
- **View-only vs. active control (the spectrum).** Does it just *show* the change
  (awareness), or also let the boxholder **accept / reject / undo** it (control)?
  The "actual control" framing points past passive viewing toward reversibility;
  an MVP could be view-only, but name the target. This is the same accept/reject
  surface as ProofEditor's suggested edits.
- **How it's invoked after a voice/chat edit.** The AI edits the card mid-chat; the
  boxholder then wants the diff. What surfaces it — a link in chat, a badge on the
  card, an auto-opened diff view?

## Related

- [questions-as-inline-annotations](../exploration/2026-08-01-questions-as-inline-annotations.md)
  — same ProofEditor-inspired family (inline suggested edits + provenance);
  "what did the AI change" is the sibling of "who wrote what."
- [selection-provenance-canonical-anchors](2026-07-08-selection-provenance-canonical-anchors.md)
  — anchoring/provenance machinery a diff view would lean on.
</content>
