---
title: "Card URLs carry `/_content/`; a browse URL without it could default to the content area"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-card-reading — printable cards
resolution: wontfix
---

Closed 2026-10-20: the boxholder is fine with `_content/` in URLs. What matters is text a person reads in the interface, which the card-reading work fixed.

Every card URL in the app is `/<box>/browse/_content/<path>`. The `_content/`
segment is a correct address, but it is noise to a person who reads or shares
the URL. The boxholder wants `_content/` much less visible in the interface.

The card-reading work removed it from user-facing text (Properties "Filed at",
the Drive mount forms and list, the chat archive message, the printed card
footer). URLs still carry it, and the printed QR code encodes it.

## Research

- A `/browse/` path without an area segment would need to resolve to
  `_content`, while `/browse/_config/...` and the other areas keep working.
  Old URLs must keep resolving.
- URL builders: `ThemedFileCard.tsx` (`withBase(\`/${boxSlug}/browse/${path}\`)`),
  `CardPrintFooter.tsx` `cardAddress`, `dashboard/AttentionCards.tsx`, and the
  browse route parser (`lib/browse-card-state.ts`).
- `shared/display-path.ts` `fromDisplayPath` already maps `x/y` to
  `/_content/x/y`.
