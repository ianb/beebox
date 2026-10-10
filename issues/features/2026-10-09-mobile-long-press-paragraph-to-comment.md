---
title: "Mobile: long-press a paragraph to comment on it, instead of selecting text"
workstream: unknown
area: beebox
labels: [mobile, ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder idea, tentative ("Maybe, not sure")
---

To comment on part of a document, the user selects text, and a floating "+"
adds the selection to the chat composer (`SelectionCapture.tsx`). The chat
transcript uses the same path (`TranscriptSelection.tsx`). On a phone, text
selection is slow work: the long-press starts a word selection, the user
drags handles, and the OS selection menu covers the "+".

The idea: on mobile, long-press a paragraph (or another block, such as a list
item or a table row) to start a comment on the whole block. The block becomes
the captured selection. The user does not need to adjust selection handles.

The boxholder is not sure about this. Questions to settle before building:

- **Conflict with the native long-press.** iOS and Android use a long-press to
  start text selection. If a long-press captures the block, the user may not
  be able to select a smaller range. Options: a block-level gesture only on a
  part of the block (a margin or gutter), a different gesture (a double tap),
  or a block capture with a later step to narrow it.
- **The iOS app webview.** The native app may also handle the long-press
  (link previews, context menus). Check the behavior in the app and in Safari.
- **Granularity.** A paragraph can be too large for a precise comment, and a
  heading or a list item can be too small. Decide which block types are
  targets.
- **Locator.** `extractSelection` computes a position locator from a DOM
  range. A block capture can produce a range that covers the block, so the
  existing locator and the chat attachment format can stay the same.

Related: [selection-capture arrow](2026-10-08-selection-capture-arrow-points-at-composer.md),
[transcript selection](../closed/features/2026-09-11-select-transcript-text-into-the-composer.md).
