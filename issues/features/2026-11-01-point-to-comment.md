---
title: "Comment by pointing: tap a comment button, then tap the thing to comment on"
workstream: unattached
area: workstreams-app
labels: [comments, exhibits, mobile, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder request, 2026-11-01"
---

Comments on exhibits and documents in the workstreams app start from a text
selection. With the comment toggle on, a selection opens the composer
(`workstreams-app/src/frontend/components/CommentLayer.tsx`), and
`lib/selection-anchor.ts` turns the selection into the quoted text, an
optional text fragment, and the nearest heading. Text selection is slow on a
phone, and it cannot point at things that are not text, such as an image, a
chart, a screenshot in an exhibit, or a whole table.

The boxholder wants the model that claude.ai artifacts use. You click a
comment button, then point at what you want to comment on. The element under
the pointer highlights, and a tap or click picks it and opens the composer
beside it. It works well on mobile.

Keep what exists: a picked element still yields an anchor in the current
shape (quoted text, a text fragment where one can be made, the section), so
in-page highlights and the agent's `bin/comments` reading are unchanged. Text
selection stays available for comments on a span smaller than an element.

To settle:

- **What can be picked.** Block elements (a paragraph, a list item, a table
  or a row, a figure, an image, a code block) or any element, and how a
  person moves to a larger or smaller target.
- **Anchors for non-text targets.** An image or chart has no quotable text. It
  could use its alt text, caption, or source path, plus an element path for
  in-page highlighting.
- **Screenshots.** Optionally attach a cropped capture of the picked element,
  so the agent sees what the person saw. This matters most for visual
  exhibits, where the text alone does not say what is wrong.
- **Mobile.** A tap must pick, not follow a link or start a selection, while
  the mode is on.

Neighbors: `issues/features/2026-10-09-mobile-long-press-paragraph-to-comment.md`
(the same problem on box pages, through a long-press) and
`beebox/docs/plans/document-comments.md` (the comment store and its anchors).
The box app's selection-to-chat flow could use the same picker later.
