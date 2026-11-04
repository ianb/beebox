---
title: "Point at box document content to attach it to chat"
workstream: point-to-comment
design: ../../../beebox/docs/implemented-plans/point-to-comment.md
area: beebox
labels: [comments, mobile, ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder request, 2026-11-01"
resolution: implemented
---

**Closed (implemented, 2026-11-04):** 02d70e879 implements the corrected box companion selection flow. Physical phone touch remains unverified; image pins, screenshots, standalone browse, and embedded PDFs remain outside the shipped scope.

When a person reads a box document beside chat, the current way to quote part
of it is to select text and press the floating `+`. The selection appears in
the ordinary chat composer as a pill and an inline `[selection#N]` token. A
selection made during transcription is placed in the spoken message. This
works on a desktop but text selection is slow on a phone and cannot directly
choose a whole image, chart, or table.

The boxholder wants a visible Select mode in the document's top bar. On
desktop, hover shows what would be selected and click attaches it immediately.
On mobile, tap chooses a block and a nearby `+` confirms it. The person can then type or dictate in the
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
revised [plan](../../../beebox/docs/implemented-plans/point-to-comment.md) follows the
existing box selection-to-chat flow.

## Implementation (2026-11-04)

The box companion now shows Select for rendered `.doc.card` and Markdown
documents. On desktop, hover outlines a semantic block and click adds the
existing selection pill and `[selection#N]` to the ordinary chat draft. On
touch, tapping outlines the block and shows the existing floating `+` beside
it; pressing `+` attaches it. A link tap chooses its paragraph
without navigating. Outside the mode, precise text selection and its `+`
remain. Code indentation and line breaks are preserved in quoted blocks; a
pending pick is discarded if its content changes, and its `+` hides when the
block scrolls out of view.

Desktop Chromium checks show hover and one-click attachment. At phone width,
synthetic touch events exercised tap then `+`, but the browser profile did not
produce native touch events, so a physical touch gesture remains unverified.
The first pass uses image alt, caption, or source text.
A point pin, screenshot, standalone browse control, and embedded PDF support
remain design questions; lean toward keeping them out until this chat
attachment flow is used.

Related: [mobile paragraph capture](../../features/2026-10-09-mobile-long-press-paragraph-to-comment.md)
proposed a long press tentatively; the visible mode here avoids the conflict
with native text selection. [Canonical selection anchors](../../features/2026-07-08-selection-provenance-canonical-anchors.md)
remain separate work.
