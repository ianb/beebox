---
title: "Capture upload error/retry affordance is tiny and gives no feedback on click"
workstream: capture-chip-states
area: callback-box
filed-by: agent
discovered-in: main session — boxholder tried to retry a failed capture upload
priority: important
needs: [manual-testing]
---

> **⏳ Awaiting manual testing on a real device** — fix landed in `9e6caef8`.
> The failed-upload banner is now a full-width, thumb-sized Retry that shows it
> started and reports how the batch ended. A simulator cannot settle a
> touch-target question. Only the developer clears this.

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

## What landed (2026-08-21)

- The banner is now a block: the failure line, a full-width control at least
  48px tall reading `Retry 3 uploads`, and the "or press Done" note beneath it.
- Retry has an in-flight face (`Retrying 3 uploads…` with a spinner) and reports
  its outcome — `All uploads recovered.` for three seconds, or the failure line
  again reading `failed again`, which is the difference between "you did
  nothing" and "it did not work". The states are a pure reducer
  (`src/frontend/src/pages/capture/retry-feedback.ts`), doctested in
  `test/frontend/capture-retry-feedback.doctest.md`.
- `StatusBar`'s three separate tiny `retry` links are gone. They competed with
  the control row for the same action; the counts there are status only now.

Every face is drivable without a device at `/<worktree>/dev/capture-mode`
("Failed-upload banner — every retry face").

## Manual testing

On the phone, not a simulator — this is a touch-target and feedback problem.

1. Start a capture, take three or four photos, then put the phone in airplane
   mode so the uploads fail.
2. The banner must be immediately noticeable and the Retry button comfortable to
   hit with a thumb, without zooming or aiming.
3. Tap Retry while still offline. It must visibly change to `Retrying N…` and
   then come back reading `failed again` — the point is that the tap is never
   ambiguous.
4. Restore connectivity and tap Retry. It must report `All uploads recovered.`
   before going quiet.
5. Say whether the button is big enough where your thumb actually lands — it is
   near the bottom of the screen, above the record control.