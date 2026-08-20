---
title: "Card diff view: highlight what changed as a card is edited (control during voice/chat editing)"
workstream: unknown
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder wants to see what the AI actually edited
priority: normal
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

## Baseline = git history (boxholder's steer)

The card's own git history is the diff backbone. A box is a git repo and every
edit is a commit, so the view **maps to git history**: it sees that a commit
updated the card and shows the change **against the previous committed version**
(the parent commit's copy of that file). This answers the "what is the before"
question without inventing a separate snapshot mechanism — the versions already
exist — and gives natural per-commit granularity and history navigation. Caveats
to design for:

- **Commit granularity.** The diff is only as fine as the commits. If the agent
  batches many edits into one commit, the "what did it do" view is coarse; if it
  commits per logical edit, it maps cleanly. Worth checking how card edits commit
  today.
- **Uncommitted working-tree state.** An edit that has not been committed yet is
  not in history — the view must also handle "working tree vs HEAD," not only
  committed-vs-parent, or a just-made voice/chat edit would be invisible until
  commit.
- **Renames.** `cb mv` moves cards (and rewrites refs); follow history across
  renames (`git log --follow`) so a moved card keeps its diff lineage.

## Design questions

- **Rendering — diff the RENDERED markdown, not the source (boxholder preference).**
  The boxholder would much rather see a diff of the *rendered* card than of the raw
  markdown text, even though rendered-diffing is the harder path. Seeing `**bold**`
  become `*em*` in source is noise; seeing the rendered result change is the point.
  The likely-tractable approach is **diff the source/AST, then render one document
  with the changes marked inline** — you don't diff HTML trees (fragile), you diff
  at the markdown/AST level and present the result rendered with insertion/deletion
  styling (the strikethrough-old + inserted-new look — see the ProofEditor
  screenshot that inspired
  [questions-as-inline-annotations](../exploration/2026-08-01-questions-as-inline-annotations.md)).
  Cards already parse through **Markdoc**, so its AST is the natural leverage point
  — an AST-level diff is also more robust to formatting-only churn than a raw text
  diff. Open hard part: **block-structural changes** (a heading added, list
  reordered, a table cell edited) render differently than inline word changes and
  need their own treatment; inline-within-a-paragraph is the easy case.
- **Structured fields / media.** Frontmatter or schema fields → a field-level diff.
  Media → likely unsupported (partial coverage is fine, per the scope note).
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
