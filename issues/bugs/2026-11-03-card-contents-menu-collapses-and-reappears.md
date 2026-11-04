---
title: "A long card's contents menu collapses and reappears while the reader looks at it; its collapse is driven by React state and the menu remounts"
workstream: contents-menu-stable
area: beebox
labels: [frontend, cards, contents-menu]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-11-03"
---

Seen on a hosted box: a long `.doc.card` report open beside a chat
(`/chat?card=<path>&session=<id>`). The card's contents menu (the "Contents"
button at the top right of a long Markdown card) keeps collapsing and then
showing again. At the time, the chat's background agents were editing cards
in the box, including that report.

The boxholder's two points:

1. Handling the collapse through rendering is fragile.
2. Separately, something re-renders or remounts the menu.

Code: `beebox/src/frontend/src/components/CardContents/CardContentsMenu.tsx`,
mounted by `components/themes/ThemedFileCard/CardThemeSurface.tsx`.

Leads, to verify:

- **Collapse by state.** The full or resting look (`data-resting`) comes from
  a `scrolling` state that every scroll event sets to true, then back to
  false 1.2 s after scrolling stops. Every change re-renders the button and
  its label. A CSS-only treatment (resting by default; full on `:hover`,
  `:focus-within`, open, and a scroll-driven class set without React) would
  not depend on renders.
- **Outline from the rendered DOM.** The outline is read from
  `[data-card-outline]` by a `MutationObserver` on the whole card front.
  `sameOutline` also compares the heading *elements*, so when the Markdown
  body re-renders with new heading nodes, the outline counts as changed even
  though the headings are the same, and the scroll-tracking effect restarts.
  If the body is briefly empty (a loading state, a Suspense fallback, a
  remount on a card update), `readOutline` returns null and the menu unmounts,
  then mounts again. That would look like collapsing and reappearing.
- **Why the body re-renders.** Find what re-renders or remounts the card in
  the chat side panel during this: the card's own edits arriving over the
  bus, `card-created` and file-change bursts invalidating queries (the nav
  counts path invalidates on every burst, see `AppNav/nav.tsx`), or a key
  change on the panel. A card update that only changes text should keep the
  body mounted and the menu stable.
- A sturdier outline source would be the Markdown itself (the headings the
  renderer is about to emit), with the DOM used only to find positions for
  the current-section label.

Reproduce locally: open a long Markdown card beside a chat, edit the card file
repeatedly (or create cards in a loop) and watch the menu.
