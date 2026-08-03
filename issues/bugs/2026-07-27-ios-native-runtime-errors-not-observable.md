---
title: "iOS native and web-view runtime errors are not observable"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main — diagnosing automatic speech playback failures in the iOS app
---

When behavior fails only inside the iOS shell, there is no durable, user-accessible
diagnostic record. Xcode's console helps only while a development build is attached,
and browser-side errors inside `WKWebView` are not available after the fact. Automatic
speech playback, for example, can visibly skip through a queue without leaving
anything the user can inspect or share.

A design should decide how to capture and export a small, privacy-conscious diagnostic
bundle. It should consider Swift task and audio-session failures, `WKWebView`
navigation/process failures, selected JavaScript errors and rejected media playback,
timestamped app state transitions, redaction of box URLs and credentials, rotation,
retention, and an explicit user action to copy or share the result.

This should not become unrestricted console capture: transcripts, message text,
device tokens, and box content are sensitive. The work is large enough to design
separately from any individual playback fix.

**Update 2026-08-03 (worktree-ios-log-forwarding):** the server-side half of
this shipped — native error/warn logs now forward to the box's
`client-debug.log` via `debugLog.submit`, tagged `[ios]`, with a persisted
offline queue, metadata-only message discipline, and device-token redaction
(design: `callback-box/docs/plans/ios-log-forwarding.md`). Instrumented:
capture upload/acquisition, bulk photo batch, chat API degradations, webview
process death and navigation failures. Still open from this issue's scope: a
user-facing on-device export/share of a diagnostic bundle, and timestamped app
state transitions beyond failure sites.
