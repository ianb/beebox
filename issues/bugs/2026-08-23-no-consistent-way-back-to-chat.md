---
title: "No consistent way back to chat from browse or a card page — worst on iOS, where there is no browser chrome"
workstream: unattached
area: callback-box
labels: [navigation, mobile, ios, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder stuck on a card page on iOS
---

Getting from chat into a card or the browse view is easy and has several
routes. Getting back is not, and on iOS there is no visible route at all.

## Why the return trip is missing

The app bar dropped its link row deliberately — `AppNav.tsx:5-7`:

> There is no link row, box `<select>`, or hamburger any more: navigation lives
> in the `PlacePill`'s two menus (switch / here) …

That is a reasonable IA decision (`docs/plans/top-nav-ia.md` Track C), but it
leaves "return to what I was just doing" with no home. The switch menu is the
closest thing, and it is not the same action: it **moves between landmarks and
resumes each one's newest chat** (`SessionChip.tsx:9`,
`SessionListPanel.tsx:7`). So from a card page it can put you in *a* chat — just
not necessarily the one you left, and never an older chat you had open.

## On iOS the only way back is an invisible gesture

`ChatWebView.swift:166` sets `allowsBackForwardNavigationGestures = true`, so
swipe-back exists. That is the whole affordance:

- **It is invisible.** Nothing on screen says you can go back, and the native
  shell has no toolbar, no back chevron, no browser chrome to fall back on.
- **Gesture-back against a client-side router is unreliable**, and it competes
  with horizontal gestures inside the page.

So a boxholder who taps into a card from chat on a phone has no visible way home
and has to know the gesture.

## What to decide

- **What "back" should mean.** Returning to *the session you came from* is the
  useful promise, and it is different from the switch menu's "newest chat in this
  landmark". The chat is already addressable (`?session=<id>`), so the
  information exists — nothing carries it.
- **Where it lives, without reopening the link-row decision.** The no-link-row
  choice was deliberate; the answer is more likely a contextual affordance
  (present only when you arrived from a chat) than a permanent nav item.
- **Whether iOS needs something native.** A web-only fix leaves the shell with
  no chrome; a native back control would cover every page including ones that
  forget. Decide rather than assume — it is a mobile-contract question if the
  shell has to know what "back" means.

## Related

- [No visible search box and no home surface](../features/2026-08-08-no-visible-search-or-home.md)
  — the same shape from the other direction: reaching the knowledge base rather
  than leaving it. Both are consequences of navigation living entirely in the
  place menus.
- The browse route from a chat card pane is itself a single unlabeled icon
  (`FileView.tsx:296`), noted in
  [PDFs and document cards have no real view](../features/2026-08-23-pdf-and-document-cards-have-no-real-view.md).
  Entry and exit are both thin; the exit is thinner.
