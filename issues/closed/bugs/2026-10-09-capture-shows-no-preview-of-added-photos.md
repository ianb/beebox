---
title: "Capture shows no preview of the photos just added"
workstream: capture-photo-flow
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walks, 2026-10-09
resolution: implemented
---

> Fixed in `e2d468d33`: the capture overlay shows a row of thumbnails between the camera and the controls. Tapping one opens the lightbox, as in the composer. There is no remove, because capture has no route to take back a photo that is already staged. Each tile shows uploading, failed, or can't-read. Photos staged before a resume show as numbered tiles.

In the B-inventory walk, the walker added two photos in capture and saw only "✓ 2 photos". No thumbnails appeared and there was no way to check which photos were in the set before pressing Done.

The status bar renders per-kind counts only (`beebox/src/frontend/src/components/capture/CaptureOverlay/StatusBar.tsx:73-80`: uploading count, failed count, or a tick with the total). The overlay renders no preview of added photos. The 2026-10-08 B walk could not test this.

Open question: where a preview would sit in the overlay, and whether a tap on it should open the lightbox or remove the photo. The composer already shows attachment thumbnails; see [composer-attachments-listed-in-reverse-order](2026-10-08-composer-attachments-listed-in-reverse-order.md).

Report: [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 13).
