---
title: "The capture error banner covers the device settings panel"
workstream: small-bugs-batch
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — exercising capture mode in the /dev/capture-mode harness
resolution: implemented
---

Closed 2026-08-29 by this commit (`fix(capture): keep error banner clear of device settings`): the banner now participates in layout between settings and the viewport.

In capture mode, an error banner and the device settings panel occupy the same
strip below the status bar, and the banner is drawn on top. With both visible,
the red banner hides the "Camera" and "Microphone" select labels.

`CaptureErrorBanner` is `absolute top-14 … z-20`
(`callback-box/src/frontend/src/components/capture/CaptureErrorBanner.tsx:13`).
`DeviceSettings` sits in normal flow directly under the status bar
(`callback-box/src/frontend/src/components/capture/CaptureOverlay.tsx:136-141`,
panel markup in `DeviceSettings.tsx:21`), which is the same vertical band.

The two are shown together in an ordinary case: the camera fails to start, the
person opens device settings to pick a different camera, and the error message
about the failure is sitting over the picker.

Distinct from `2026-08-03-capture-upload-error-retry-affordance-weak.md`, which
is about the failed-upload retry control in `CaptureControls`.
