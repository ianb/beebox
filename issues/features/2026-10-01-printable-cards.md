---
title: "Printable cards: a print button, and a way back to the card that is not `/_content/`"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

A card has no print action. The boxholder wants a print button on the card
page, and a printed card that leads back to its live card.

Print CSS already exists in parts: `src/frontend/src/index.css` (`@media print`
blocks), `src/frontend/src/themes/card-themes.css` hides
`[data-card-page-actions]`, and `chrome.css` hides the composer. Nothing in the
frontend calls `window.print()`, and the existing print rules have never been
checked as one printed page.

## Open questions

- **Where the button lives.** The card page actions are the obvious place. The
  actions are hidden in print already.
- **How the printed page links back.** Options: a QR code to the card URL, a
  printed path, or both. A QR code needs a stable public or LAN-reachable URL;
  a local dev URL or a box behind auth makes it less useful.
- **What path text to print.** The current URL is
  `/<box>/browse/_content/<path>`. The `_content/` segment is useful as an
  address, but it is noise to a reader. Printed text should be the friendly
  form: `src/shared/display-path.ts` already drops `_content` for breadcrumbs
  (`BrowseBreadcrumbs.tsx`).

## Broader: `_content/` shows in the UI too much

The boxholder considers `_content/` useful but wants it much less visible in
the UI generally. It still appears in user-facing copy, for example:

- `components/settings/DriveSection/DriveMountForms.tsx:74,140` — helper text
  `e.g. _content/drive/recipes`.
- `components/chat-delete/ArchiveChatSection.tsx:48` — "Moves this chat's card
  to _content/chat/archive/".
- Every card URL (`/browse/_content/...`).

Hiding it in URLs is a routing change (a `/browse/` path without `_content`
would need to default to the content area). That may be its own issue; print
is the first place it matters.
