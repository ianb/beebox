---
title: "Capture on desktop reports a permission error while the site's camera and mic permission is granted"
workstream: unattached
area: beebox
labels: [capture, desktop]
filed-by: agent
discovered-by: Ian
discovered-in: main session — developer tried capture on a desktop browser, 2026-11-16
---

The developer opened capture in a desktop browser and got a permission error. The browser's site permission for the box looked correct. The exact message text is not recorded.

Capture shows the browser's raw error after a fixed prefix: "Camera access failed: …", "Camera switch failed: …" (`beebox/src/frontend/src/pages/capture/useCaptureSession/useCaptureCamera.ts`) or "Microphone access failed: …" (`useCaptureSession/hook.ts`). It does not look at the error name. So different causes produce similar text, and none of these messages tells the person what to do.

## Possible causes

- **The operating system blocks the browser.** On macOS, System Settings → Privacy & Security → Camera (or Microphone) must allow the browser itself. If it does not, Chrome rejects with `NotAllowedError` "Permission denied by system", while the site permission still shows Allow. This matches the report best.
- **Another app holds the camera.** `NotReadableError`, "Could not start video source".
- **A stored device is gone.** Capture saves the chosen camera and microphone in localStorage (`loadDevicePrefs` in `beebox/src/frontend/src/pages/capture/api.ts`), and asks for that device with `deviceId: { exact }` (`beebox/src/frontend/src/lib/camera.ts`). If the device is not connected, for example a phone camera through Continuity or an external webcam, the request fails with `OverconstrainedError` or `NotFoundError`. Capture does not fall back to the default device.

## Change

- Map the error name to a message that tells the person what to do: system settings, close the other app, or "that camera is not connected, using the default".
- If the stored device is gone, clear the stored choice and start the default device.
- Next time the error happens, record the exact text to confirm the cause.
