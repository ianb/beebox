---
title: Bee Box surfaces render duplicate bbx control ids
workstream: unknown
priority: backlog
discovered-in: worktree-publish-pages — publication card browser verification
---

Several Bee Box surfaces render the same `bbx-` id on more than one element.
This creates invalid HTML, and `getElementById` or `bin/browse` can target the
wrong element.

`ComposerStatesHarness` (`src/frontend/src/pages/dev/components/`) renders the
real `ChatInputArea` + `MobileTextareaRow` + `TargetStrip` once per combo in a
cross-product gallery. Now that those components carry authored `bbx-` DOM ids
(`docs/plans/agent-points-at-ui.md`, Track 4), the gallery puts ~20 copies of
`bbx-composer-add`, `bbx-composer-send`, `bbx-composer-mic` and friends in one
document. The `/dev/capture-mode` page also renders duplicate `bbx-capture-*`
ids. Both pages are dev-only.

Options for the gallery collisions, roughly in order of appeal: thread an
optional id prefix/suppression through the harness's props so gallery copies
render unaddressed; render only one combo at a time (the `?state=` mode already
does); or strip `[id^=bbx-]` in the harness after mount. The first keeps the
harness honest about being the real components.

Found while annotating the chat surface (Track 4a).

**Also (2026-08-23, id pass):** `pages/dev/components/CaptureModeHarness.tsx`
renders `CaptureOverlay` and a bare `CaptureControls` on one page, so
`/dev/capture-mode` duplicates every `bbx-capture-*` id the same way. Same fix
shape: either the harness passes a per-instance prefix or dev harness pages are
declared out of the address space.

**Also (2026-09-26, publication card browser pass):** the Admin Overview renders
`bbx-admin-overview-secrets` twice. `components/admin/AdminOverview.tsx:18`
gives that id to the Secrets group region, and
`components/admin/AdminOverviewRow.tsx:29` gives it to the Secrets button. This
duplicate is on the product-facing Admin card, so the issue's priority may be
stale. The gallery-specific options above do not resolve this source-level
collision.

Discuss whether to include the Admin Overview collision in the same fix now or
keep this issue limited to the development galleries.
