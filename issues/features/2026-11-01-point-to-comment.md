---
title: "Point at box document content to attach it to chat"
workstream: point-to-comment
design: ../../beebox/docs/plans/point-to-comment.md
area: beebox
labels: [comments, mobile, ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder request, 2026-11-01"
---

When a person reads a box document beside chat, the current way to quote part
of it is to select text and press the floating `+`. The selection appears in
the ordinary chat composer as a pill and an inline `[selection#N]` token. A
selection made during transcription is placed in the spoken message. This
works on a desktop but text selection is slow on a phone and cannot directly
choose a whole image, chart, or table.

The boxholder wants a visible Comment mode in the document's top bar. In that
mode, a tap or click selects the block under the pointer. The existing `+`
attaches that selection to chat. The person can then type or dictate in the
ordinary composer. The selection pill, source ref, and chat serialization stay
the same. There is no separate comment input or way to enlarge the target.
Outside the mode, text selection, links, and other document controls work as
before. A tap in mode must choose the target without following a link or
starting native selection.

The first implementation covers rendered `.doc.card` and Markdown in the companion
pane. Embedded PDFs and opaque frames do not expose their content as DOM
blocks. A visual block can use its caption, alt text, or source description
as the quoted selection. A point pin or cropped screenshot would require a
new attachment representation and remains a later design question.

## Correction (2026-11-04)

The original issue identified `workstreams-app/` document comments and
`bin/comments` as the destination. That was wrong. The boxholder showed
the box app's floating `+` and the resulting selection in the chat draft.
The workstreams implementation made in this branch is being removed. The
revised [plan](../../beebox/docs/plans/point-to-comment.md) follows the
existing box selection-to-chat flow.

## Implementation (2026-11-04)

The box companion now shows Comment for rendered `.doc.card` and Markdown
documents. While it is on, choosing a semantic block shows
the existing floating `+`; pressing `+` adds the existing selection pill and
`[selection#N]` to the ordinary chat draft. A link tap chooses its paragraph
without navigating. Outside the mode, precise text selection and its `+`
remain. Code indentation and line breaks are preserved in quoted blocks; a
pending pick is discarded if its content changes, and its `+` hides when the
block scrolls out of view.

Desktop and phone-width Chromium checks show the flow. The phone-width browser
profile did not produce actual touch events, so a physical touch gesture
remains unverified. The first pass uses image alt, caption, or source text.
A point pin, screenshot, standalone browse control, and embedded PDF support
remain design questions; lean toward keeping them out until this chat
attachment flow is used.

Related: [mobile paragraph capture](2026-10-09-mobile-long-press-paragraph-to-comment.md)
proposed a long press tentatively; the visible mode here avoids the conflict
with native text selection. [Canonical selection anchors](2026-07-08-selection-provenance-canonical-anchors.md)
remain separate work.
