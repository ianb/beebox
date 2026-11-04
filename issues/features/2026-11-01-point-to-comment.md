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

## How Claude's own comments work (looked up 2026-11-01)

From Anthropic's documentation. Neither source describes the touch gestures
on mobile, so check those by hand.

Claude.ai artifacts (decks and designs), per
[Use artifacts with a keyboard or screen reader](https://support.claude.com/en/articles/17457950):

- A **Comment** button in the panel header turns on comment mode. Its label
  then reads "Done commenting", and it shows the open count ("3 open
  comments").
- In comment mode, the pickable targets are a slide and each object on it, or
  each artboard in a design. Picking one opens an "Add a comment" box next to
  it. Escape closes the box, and a second Escape leaves comment mode.
- Each comment has a **marker** on the artifact, labeled with its author.
  Markers show only while comment mode is on, and opening one shows the
  comment and a reply field.
- "More comment options" → "Show all comments" lists them, and choosing a row
  goes to that comment.
- A "Send to Claude" checkbox decides whether a comment is also a request to
  Claude. Comments without it stay as notes between people.
- In a doc, the header button shows or hides the comment list instead.
  Commenting on text there starts from a selection.

Claude Science, per [Comments](https://claude.com/docs/claude-science/comments.md):

- You can comment on selected text in text, code, or PDF files, a clicked
  point on an image (shown as a numbered pin), or a clicked element in a
  rendered HTML report while Comment is on.
- Saving a comment does not send it. Saved comments wait above the message
  box and go to Claude with the next message, so several can go together.
  Claude gets the filename, the quoted text or marked image, and the note.
  Once sent, a comment leaves the artifact and shows as a card on the message.
- There are no threads and no resolve state, and a comment is capped at 1,000
  characters.

What fits here: the mode button with an open count, element picking, markers
shown only in comment mode, and a list view. Our comments go to an agent by
workstream, so a "send" step or checkbox has no equivalent. A Science-style
point pin on an image would answer the "anchors for non-text targets"
question above.
