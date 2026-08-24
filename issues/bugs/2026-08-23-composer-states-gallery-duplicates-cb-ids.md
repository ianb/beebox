---
title: /dev/composer-states renders duplicate cb- control ids
workstream: unknown
priority: backlog
---

`ComposerStatesHarness` (`src/frontend/src/pages/dev/components/`) renders the
real `ChatInputArea` + `MobileTextareaRow` + `TargetStrip` once per combo in a
cross-product gallery. Now that those components carry authored `cb-` DOM ids
(`docs/plans/agent-points-at-ui.md`, Track 4), the gallery puts ~20 copies of
`cb-composer-add`, `cb-composer-send`, `cb-composer-mic` and friends in one
document — invalid HTML, and it would fail axe's `duplicate-id-active` if the
page were toured (it isn't: `test/tours/nav-pages.tour.ts` covers the ten
routed product pages only).

Nothing product-facing is affected — the gallery is dev-only, mounted under
`/dev/composer-states` in dev builds. But `getElementById` in that page returns
the first of twenty, so the gallery is also the one place a `control:` link
would silently point at the wrong tile.

Options, roughly in order of appeal: thread an optional id prefix/suppression
through the harness's props so gallery copies render unaddressed; render only
one combo at a time (the `?state=` mode already does); or strip `[id^=cb-]` in
the harness after mount. The first keeps the harness honest about being the
real components.

Found while annotating the chat surface (Track 4a).

**Also (2026-08-23, id pass):** `pages/dev/components/CaptureModeHarness.tsx`
renders `CaptureOverlay` and a bare `CaptureControls` on one page, so
`/dev/capture-mode` now duplicates every `cb-capture-*` id the same way. Same
fix shape: either the harness passes a per-instance prefix or dev harness pages
are declared out of the address space.
