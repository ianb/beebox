---
title: "Repeated frontend markup that needs a missing ui primitive or a visual decision"
workstream: dup-sweep-frontend
resolution: implemented
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
---

Closed by the plan [frontend-visual-near-duplicates](../../../beebox/docs/implemented-plans/frontend-visual-near-duplicates.md), commits 8c2371aea through 6f3b0f124.

Part of the [functional-duplication sweep](../../code-quality/2026-10-22-functional-duplication-sweep.md).
The sweep merged markup that rendered identically. These groups render
differently today, so a merge changes how something looks or what a screen
reader hears.

- **Warning and danger banners.** About thirteen copies of
  `bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark` and its
  danger twin, with mixed `p-2`/`p-3` and mostly no `role="alert"`: Drive section
  (`DriveMountForms.tsx:21`, `DriveMountRow.tsx:211`, `view.tsx:43`),
  `CalendarSection.tsx:80`, `PdfStatusNotice.tsx:41`, `GoogleServicesSection/view.tsx:100,128,173,183`,
  `GmailFiltersSection/view.tsx:73,227`, `ClaudeCodeSection.tsx:89`,
  `NotificationsSection/view.tsx:170`. No ui primitive exists.
- **Confirm dialog shell.** `DeleteChatDialog` and `CardActions`' trash confirm share
  one class string and footer layout; the sweep merged their modal behavior
  into `useModalDialog`. `ScreenshotConsentPopup`, `CaptureResumeDialog` and
  `QuickSearchOverlay` are div overlays with their own backdrop, radius and
  padding and no native modal focus trap.
- **Phase badges.** `HistoryViewCard/CommitTimeline.tsx:45` PhaseBadge uses
  `ui/Badge`; `CommitDetail-commit.tsx:24` PhaseBadge is hand-rolled with another
  size and colour map, so one phase looks different in the timeline and the
  detail pane. `RecentActivity.tsx:58`, `CommitTimeline.tsx:110` FileStatBadges and
  `SourceViewOverlay.tsx:248` add more pills with raw palette colours.
- **Collapsible landmark groups.** `AppNav/PlacePill-here.tsx` HereGroupRows and
  `InteractiveChat/LandmarkLinksPanel.tsx` MenuGroup differ only in padding
  (`py-2` vs `py-3.5`) and the child row; `landmarks/LandmarkSection.tsx:186`
  LandmarkGroup is the page variant. `ui/Accordion` (with `aria-controls`) is used
  by none of them.
- **Loading and empty text.** Menu panels use `px-3 py-2 text-sm text-warm-700` rows
  (`SessionListPanel`, `session-search`, `PlacePill-landmarks`, `RecentFilesPanel`);
  pane placeholders (`FigureView`, `renderers/pdf`, `renderers/directory`,
  `CardBody`, history views) rebuild `ui/StatusMessage` with other padding and no
  `role="status"`.
- **Icon buttons without a name.** The composer remove bubble (now one
  `RemoveBubble`) and the dictation cancel buttons
  (`InteractiveChat-composer/view.tsx:120`, `InteractiveChat-mobile-row.tsx:63`) have a
  title but no `aria-label`; `ui/CloseButton` supplies one.
- **Copy feedback.** `ui/Button` `flash` shows "Copied". `ThemedFileCard/view/PropertiesFace.tsx:111`
  adds a "Copy failed" state Button cannot show; `SourceViewOverlay.tsx:167` rolls its
  own and swallows errors. A `flash` failure label would cover both.
