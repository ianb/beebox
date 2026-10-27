---
title: "On a doc card with an interactive widget, the contents button keeps showing the section title and hiding it again while nobody scrolls"
workstream: card-remount
area: beebox
priority: important
labels: [frontend, cards, stability]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report on a hosted box, 2026-10-26
---

On a long doc card opened in the companion pane, the contents button at the
top right (`beebox/src/frontend/src/components/CardContents/CardContentsMenu.tsx`)
repeatedly expands to show the current section's title and then shrinks
back to its resting icon. The reader is not scrolling. The card has an
interactive widget in its body (two atom pickers and a drawing that
updates when a pick changes), and external source citations.

The button is designed to be full while the card scrolls and to rest
`REST_AFTER_MS` (1.2 s) after the last scroll. So something produces scroll
events, or remounts the menu, over and over. Candidates to check:

- **A remount** of the card front, the Markdown body, or the menu: a live
  refresh that replaces the card's data, a key that changes, or a parent
  that renders a new component identity. A remount of content also resets
  the widget and anything the reader did in it.
- **A layout loop:** the widget resizes (an iframe or embedded page that
  reports its height), the scroller adjusts, a scroll event fires, the
  button expands, and its new width or the outline rebuild changes layout
  again.

## The boxholder's direction

"I really dislike remounts! Especially in content! We need firmer
boundaries!" A card that a person is reading must not remount, or appear to
remount, unless its content really changed. The fix should find the cause,
and also put a boundary in place so that a refresh, an outline rebuild, or
a sibling's state change cannot remount the body under the reader. A test
or a dev check that fails when the card body remounts during an idle
period would keep it from coming back.

## Reproduce

On test1, a long doc card with several headings and an embedded
interactive widget (an `.attach` HTML page or the same kind of embed this
card uses), opened in the companion pane at desktop width. Leave it idle
and watch the contents button; record React commits and scroll events
during the idle period. Do not use the boxholder's box; its content is
private.
