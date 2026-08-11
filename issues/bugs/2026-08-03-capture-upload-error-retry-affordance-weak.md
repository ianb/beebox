---
title: "Capture upload error/retry affordance is tiny and gives no feedback on click"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder tried to retry a failed capture upload
---

When a capture upload fails, the error indicator (which also carries the **retry**
action) is **very small** and **does not clearly react when clicked** — so the
boxholder could not tell whether the retry registered.

Two defects in one small control:

- **Too small to notice / target.** The failure surface is easy to miss and hard to
  hit, especially on mobile. The retry prompt lives in
  `components/capture/CaptureControls.tsx:50` — `{summarizeFailures} failed to
  upload.` followed by a small underlined `Retry` `<button>` (there is also a tiny
  status affordance in `components/capture/StatusBar.tsx`). It needs to be a real,
  prominent, comfortably-tappable control when uploads have failed.
- **No click feedback.** Tapping Retry (`onRetryFailed` → `retryFailedUploads`,
  `CaptureOverlay.tsx:115,129`) gives no visible reaction — no pressed/loading
  state, no "retrying…" — so the user can't tell it did anything. A retry must show
  it started (disable/spinner/"retrying N…") and then reflect success or renewed
  failure.

## Fix direction

Make the failed-upload state a clear, prominent affordance with an obviously
tappable Retry, and give Retry immediate visual feedback (in-progress state →
resolved state). This sits on the capture flow that has already been fragile under
upload failures (see the 07-29 many-photos aborts and
[capture-teardown-race](2026-07-30-capture-teardown-race.md)), so the error/retry UX
is exactly where a user lands when those bite. Verify on a real device — this is a
mobile touch-target + feedback issue.
