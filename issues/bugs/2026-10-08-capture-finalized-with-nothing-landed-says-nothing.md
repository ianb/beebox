---
title: "Finishing a capture in which every upload failed says nothing in the chat"
workstream: unattached
area: beebox
labels: [low]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk (second walk), 2026-10-08
---

In the second B-inventory walk both photo uploads of a capture failed. The
walker pressed the Done tick and returned to an empty chat with no word about
the photos: "nothing stopped me, nothing said wait."

## What the product did

The failure banner ("2 photos failed to upload … Or press Done to finalize
without them") was on screen. The walker did not re-read the screen before the
click (client-debug.log: both failures before 11:06:07, tick after 11:06:12),
so part of this is walker error. The product part:

- Done enables on any photo count, failed ones included
  (`beebox/src/frontend/src/components/capture/CaptureOverlay/view.tsx:173`
  counts `photoTotal`, which includes failures).
- The finish path seals the session without sending a message when nothing
  landed (`beebox/src/frontend/src/pages/capture/useCaptureSession/useCaptureFinish.ts:80-90`).
  No message was sent (hub log), so the chat shows nothing.

The cause of the "no word" outcome is inferred from the hub log, not from a
reproduction with the code instrumented.

## Fix direction

Finish a capture with nothing landed as a visible outcome: a chat line such as
"No photos arrived", or keep the overlay open with the banner.

Report: [B2](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 13, shot 06).
