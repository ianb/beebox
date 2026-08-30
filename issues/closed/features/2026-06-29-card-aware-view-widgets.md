---
title: "card aware view widgets"
workstream: unknown
needs: [design]
area: beebox
resolution: implemented
---

**Closed (2026-07-14): implemented** via the `card-view-widgets` plan+worktree —
design in `beebox/docs/implemented-plans/card-view-widgets.md` (marked
implemented). All four open questions are resolved:
- **Widgets**: `<CardLink>` and `<CardRef>` at
  `beebox/src/frontend/src/components/view-widgets/` (`CardLink.tsx`,
  `CardRef.tsx`, `index.tsx`). CardLink's label falls back to the target's title;
  a missing target shows a `(missing)` marker.
- **Exposure (Q1)**: public `beebox/view-widgets` specifier —
  `package.json` `exports["./view-widgets"]` → `dist/view-widgets/`; types shipped
  (`src/types/view-widgets.d.ts`, release fix `70ec1dba`).
- **Small/container contract (Q2, "the crux")**: `CardRef` gives *follow* (open in
  the current surface) + *expand* (render inline via the view host); the styled
  chip is its compact form, with go/inline behavior supplied by the host so it's
  surface-correct.
- **Ref tracking (Q3)**: `cardRef="…"` attributes in box-authored `.tsx` views are
  tracked/rewritten by `bbx validate`/`bbx mv` — `rewriteViewRefs` /
  `rewriteMovedCardRefs` in `src/core/rewrite-card-refs.ts` (feat `079e04ad`).
- **Consistency (Q4)**: navigation/expand go through the shared view host
  (`useViewHost`/`openCard`), not a parallel mechanism.

Boxes can write their own views (compiled JSX via `src/webapp/views/compiler.ts`),
but there's no reusable, card-aware widget set for the most common thing a view
does: *point at another card*. Today an author hand-rolls an `<a>` and has to know
the URL scheme / `view:` ref convention, and there's no off-the-shelf way to embed
a card. The render plumbing all exists — `FileView` already has
`page | chat | companion | embed` modes, an `onNavigate(target, hint)` primitive,
and `view:`/`ViewTarget` addressing — it just isn't exposed as drop-in components
the way `beebox/cards` is exposed to box-local *schemas*.

Two widgets:

- **`<CardLink ref="…">label</CardLink>`** — link to a card by ref, resolving to
  the correct navigation (the same `onNavigate`/`view:` path the rest of the UI
  uses), with the ref validated like any card ref (so `bbx validate`/`bbx mv` track
  it — a JSX-embedded ref must not be a blind spot). The label falls back to the
  target's title when omitted, mirroring landmark `links`.
- **`<CardRef ref="…">` (link + expand)** — richer, with three affordances on one
  reference: **go** (navigate to the card), **inline** (expand it in place —
  `FileView` `embed` mode), and **small** (a compact representation). The
  interesting part: the *small* view is **controlled by the container**, not fixed
  by the widget — the container (or the target card's own renderer) decides how to
  summarize: a one-liner, a tile, a self-authored summary, whatever fits. So the
  widget delegates the small rendering rather than hardcoding a card chip.

Open questions:
- **Exposure to compiled views.** How the widgets reach a box-authored view — a
  public `beebox/view-widgets` (or similar) specifier the compiler leaves
  unbundled / injects, paralleling `beebox/cards` for schemas. What's the
  import surface and how it resolves in both the browser and `bbx view test`.
- **The "small, container-controlled" contract.** Who actually renders the small
  form — a new `summary`/`small` `FileViewMode`? the target card's renderer
  exposing a compact variant? a render-prop the container supplies? This is the
  crux; the other two affordances (go, inline) already have homes.
- **Ref tracking.** Refs written inside JSX views need the same auto-tracking as
  card refs (`bbx validate`, `bbx mv` rewriting) — otherwise moving a target silently
  breaks a view. This is the same hazard the link-validation work just closed for
  markdown; JSX views are the next surface.
- **Consistency with what exists.** Landmark `links` (and the new chat-header
  landmark menu) already "go / open in sidebar"; these widgets should share the
  same open-in-companion mechanism (`onZoomView`) rather than invent a parallel
  one. Related: "The interface itself as cards" and "Agent-editable UI text".
