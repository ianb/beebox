---
title: "Card views cannot scroll — content below the fold is unreachable in all three views"
workstream: integration-tests
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 2)
labels: [soft-launch, field-test-findings, ui-error]
resolution: implemented
---

> **Closed 2026-08-09 — largely a harness artifact, with one real a11y gap
> fixed.** Live re-test (dev router, agent-browser): mouse-wheel over the
> content scrolls all card surfaces, and programmatic `scrollTop` writes
> stick. What the operator drove was agent-browser's *window-level* scroll
> (`scroll down`, PageDown/End with body focus) — the app is a fixed shell
> whose window never scrolls, so those are no-ops by construction, not an app
> refusal. (The "scrollTop reads back 0" diagnosis did not reproduce.)
> The real product gap: the scroll containers weren't keyboard-focusable
> (axe `scrollable-region-focusable` — a container with focusable children is
> never keyboard-scrollable by default), so keyboard-only users genuinely
> couldn't scroll. Fixed: `Column` gained a `focusable` prop (tabIndex 0 +
> focus ring) applied on the card page and browse detail pane, and the chat
> companion tabpanel got `tabIndex=0` (the tabpanel pattern wants it anyway).
> tabindex/focus verified live; native key-scroll of a focused scroller is
> standard browser behavior that agent-browser's raw key dispatch can't
> exercise. The operator prompt's mechanics layer now teaches how to scroll
> (mouse move + wheel / scrollintoview) and to verify with a screenshot
> before reporting anything unreachable. agent-browser's flaky wheel dispatch
> is filed as
> [agent-browser-wheel-dispatch-flaky](../../bugs/2026-08-09-agent-browser-wheel-dispatch-flaky.md).
A recipe card longer than the viewport is unreadable: the view cuts off (in the
prototype: right after the third ingredient) and no scroll input moves it. The
failure is identical in all three surfaces that render a card:

1. the chat side panel (card opened from a chat link),
2. the browse page (`/<box>/browse/<path>`, with the file sidebar),
3. the full card view ("Open full view →", the `?view=` page).

Mouse wheel, `PageDown`, and `End` all do nothing. This blocks the core "saved
it, now read it" loop — the field-test operator could not read its own recipe
and had to ask chat to recite the ingredients.

## Diagnosis so far

On the browse view of a `.recipe.card`:

- `document.documentElement.scrollHeight === window.innerHeight` — the window
  itself has nothing to scroll (expected; app is a fixed shell).
- The card content lives in a `div.flex.flex-col.items-stretch.overflow-auto.flex-1`
  with `scrollHeight 1304` vs `clientHeight 523` and `overflow-y: auto` — it
  SHOULD scroll.
- **Programmatic `el.scrollTop = 500` immediately reads back `0`.** Something
  resets or prevents the scroll position (re-render? a scroll-lock handler? a
  zero-height ancestor making the browser treat it as unscrollable despite the
  computed style?). This is why keyboard and wheel fail too — it is not an
  input-routing problem.

Repro: any box; save a card whose rendered body exceeds the viewport; open it
in any of the three views; try to scroll. Likely home: the shared card/file
renderer container (`src/frontend/` — FileView / renderers), since all three
views fail identically at the same pixel.

Related: the "Open full view →" link and the pop-out icon both present
themselves as the escape from the cramped panel and inherit the same bug —
worth a regression test that a long card is fully reachable in each view.
