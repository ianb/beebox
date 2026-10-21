---
title: "Print options and printable forms for cards"
workstream: unattached
area: beebox
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-card-reading — reviewing the card Print control
---

A card's Print control (Properties) prints the card front with a fixed
footer: the box and the card's path. A QR code of the card's address is opt-in
(an "Add QR code" checkbox, offered only when the page was opened at a network
address); the boxholder does not want it by default. Beyond that, the person
has no say in what goes on the page.

The boxholder's interest is specific printable forms: pages meant to be
printed and used on paper, not a printout of whatever is on screen. Options
such as whether to include the QR code are part of that.

## Open questions

- What a "printable form" is: a print layout a card type or view declares, a
  card made for printing, or options chosen at print time.
- Which options matter: QR code on or off, path line, fields versus body,
  one card per page.
- Where options live: a small dialog before printing, Properties, or the card
  type's own definition.

## What exists

- `lib/print-card.ts` scopes printing to one card;
  `themes/ThemedFileCard/view/CardPrintFooter.tsx` draws the footer;
  `lib/off-machine-origin.ts` decides the QR code.
- The browser's own print command (Cmd-P) prints the screen as it is,
  including the workspace tabs and the desk color. Not a goal to fix on its own.
