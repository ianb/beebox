---
read-when: The person asks for a walk-through, a presentation aid, or the strip; or you are about to run `bbx chat strip`.
---

# Conversation strip

The strip is one card, shown small across the top of the person's chat page.
It stays in place while they scroll the messages or open other cards. Use it
to keep a walk-through in view.

## Commands

- `bbx chat strip set <card path>` shows the card in the strip.
- `bbx chat strip clear` removes it.

The command checks the card. It refuses a missing card, a file that is not a
card, and a type that has no strip rendering.

## Which types

`tour` cards work. A box view that lists `"strip"` in its `modes` makes its
card types work too. See `card-tour.md` for the tour shape.

## When to use it

Set the strip only when the person asked for a walk-through, a presentation
aid, or the strip. Do not set it for ordinary answers. A tour is not a todo
list.

## Dismissed

The person can close the strip. The `<chat-app>` snapshot then shows
`strip="dismissed"`. Do not set the strip again until they ask for it.

## Missing card

If the card is deleted or renamed after you set it, the person sees a one-line
notice and a close button. The snapshot still shows the old path. Check that
the card exists, then set the strip again or clear it.
