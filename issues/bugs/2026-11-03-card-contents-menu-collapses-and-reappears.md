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

## Research (2026-11-03)

Plan: `beebox/docs/plans/contents-menu-stable.md`. Reproduced on the
worktree's test1 clone, in the chat side panel, with a probe that watched the
card front, the outline root, the headings, and the menu element.

- **Main cause: scrolls the reader did not make.** With the reader in the
  middle of the card, each edit that grows the text above them made the
  browser's scroll anchoring move the scroller to keep their place. Each
  move is a `scroll` event, and the menu counted every scroll event as the
  reader scrolling. 4 edits gave 4 expand/collapse cycles, with no remount.
  Fixed: only a scroll with recent reader input (wheel, touch, scroll keys
  outside a field, a scrollbar drag) or an ongoing reader scroll makes the
  button full. The full look is a `data-scrolling` attribute set on the
  element, with no React render; at rest is the CSS default.
- **Remount: a failed re-read.** In-place, atomic-rename, frontmatter, git
  commit, card-creation, and real chat-agent edits did not remount anything.
  A re-read that fails (the file briefly missing, the box restarting) showed
  the "Not up to date" notice. The notice wrapped the body in a Fragment,
  which remounted the whole card body when the notice appeared and again
  when it went away (`components/FileView/view.tsx`, `withBodyNotices`).
  Fixed: the wrapper always has the same shape.
- **Outline.** It now comes from the Markdown tree the card renders, through
  `CardOutlineContext`, not a MutationObserver over the card front. A
  text-only edit keeps the same outline. An embedded card cannot publish
  its headings into the outer card.
- `bin/card-remount-check` had stopped working (card path without the
  leading `/`). It is fixed, and it now also checks text added above the
  reader and a failed re-read. On the old code it fails on both. On the new
  code it passes.
- Not fixed here: a re-read that lands on a half-written file. Filed as
  [its own issue](2026-11-03-card-reread-of-a-half-written-file-reshapes-the-open-card.md).
