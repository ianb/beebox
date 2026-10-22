---
title: "The image lightbox has no dialog role"
workstream: chat-chrome-fixes
area: beebox
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walks, 2026-10-09
---

> **Closed 2026-10-16:** Fixed by `6d79c26d9`. The lightbox is a native `<dialog>` opened with `showModal()`: dialog role, a modal (inert) page behind, Tab contained, focus starting on Close and returning to the opener; labelled by the image's alt text (plus position when several). Verified in the browser: before, 63 page controls stayed reachable and focus stayed in the page.

The image lightbox is a modal overlay, but a screen reader gets no modal context. `beebox/src/frontend/src/components/ImageLightbox.tsx:115-131` renders a portal `div` with a full-screen backdrop `button` (`aria-label="Close lightbox"`). The file has no `role="dialog"`, no `aria-modal` and no accessible name for the overlay (checked with grep: neither string appears).

In the B-inventory walk, the walker's count of open dialogs missed the lightbox for this reason (row 66).

Fix direction: put `role="dialog"`, `aria-modal="true"` and a label on the root. Check focus handling (trap and restore) at the same time. Related: [lightbox mobile gestures](../features/2026-07-20-lightbox-mobile-gestures.md) (closed; same component).

Report: [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (R7, row 66).
