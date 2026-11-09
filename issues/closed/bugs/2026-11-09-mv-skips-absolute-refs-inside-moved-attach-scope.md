---
title: "bbx mv of a card leaves stale box-absolute refs in the cards of its own .attach/ folder"
workstream: box-feedback-bugs
area: beebox
labels: [refs]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Mv_Leaves_Stale_Refs_Inside_Attach_Scope, 2026-11-09"
resolution: implemented
---

**Closed (implemented, 2026-11-09):** bbx mv rewrites refs in files that moved with the card's attach directory, from their old location to the new (box-feedback-bugs). The plain-text mention idea is filed as issues/features/2026-11-09-mv-lists-old-path-mentions-outside-tracked-refs.md.

A box agent moved a card to a subdirectory with `bbx mv`. The command moved
the card and its `.attach/` folder (four cards and an `AGENTS.md`). It
updated a ref in one outside card and two relative refs in the moved card.
The cards inside the moved `.attach/` folder kept box-absolute refs to the
old paths: a frontmatter `ref:` to the parent card, a ref to a sibling card in
the same folder, and body links. `bbx validate` then reported 6 broken refs.
The agent fixed them by hand.

The same thing happened again on a rename in place to a new card type
(`X.course.card` → `X.dev-course.card`): refs from the four attached cards to
the parent card stayed on the old filename.

## Mechanism

`rewriteOtherReferrers` skips every file under the new attach directory
(`beebox/src/core/commands/move/operations.ts:225-228`). The comment says
"their internal refs travelled with them intact". That holds for relative
refs only. A box-absolute ref from an attached card to the parent card, or to
another file in the same folder, now points at the old path.

The [closed directory-move fix](2026-09-16-bbx-mv-directory-leaves-self-refs-stale.md)
handled the same shape for `bbx mv <dir>`
(`transformForMovedCard`). The single-card path with an attach scope does not
use it.

## Expected

Rewrite box-absolute refs in moved attached files whose targets moved in the
same operation.

## Also seen

Box paths in plain text outside cards (box code such as `src/schemas/*.ts`
instruction strings, an attach folder's `AGENTS.md`) are not tracked refs and
went stale as well. The agent suggested that `bbx mv` list textual matches of
the old path outside cards, so they are not missed.
