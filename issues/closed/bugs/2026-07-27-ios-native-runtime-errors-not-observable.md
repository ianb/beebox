---
title: "iOS native and web-view runtime errors are not observable"
workstream: ios-log-forwarding
area: beebox
filed-by: agent
discovered-in: main — diagnosing automatic speech playback failures in the iOS app
resolution: implemented
---

**Closed 2026-08-14 — boxholder's call: verification deferred to real use.**
The fix landed in `b39545a4` and the code side was re-verified today:
`BoxLog.swift:53-65` (`BoxLogLevel.info`), `RootView.swift:72,102,182,192`
(scene/navigation/speech/audio-session transitions), `audio/context.ts:78-84`
(media-error metadata), plus the offline priority-eviction queue. The design
doc moved to `implemented-plans/` marked implemented (`bd936c97`).

The `needs: [manual-testing]` flag was removed rather than cleared by testing.
The boxholder's reasoning: the original failures are too hard to reproduce on
demand, so the honest plan is to wait and find out whether the logging helps
the next time something goes wrong on the phone. Holding the issue open for a
test nobody is going to run only makes the manual-testing list less
trustworthy — an item in that list should be something he can pick up and do.

**How this reopens.** Not by someone re-reading this issue, but by the symptom:
an iOS problem that cannot be diagnosed because `.beebox/client-debug.log`
lacks the `[ios]` lines it should have, or has them with bare numeric codes
instead of symbolic labels. That is a new bug with real evidence attached, and
better than a stale open item.

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
(design: `beebox/docs/implemented-plans/ios-log-forwarding.md`). Instrumented:
capture upload/acquisition, bulk photo batch, chat API degradations, webview
process death and navigation failures. Still open from this issue's scope: a
user-facing on-device export/share of a diagnostic bundle, and timestamped app
state transitions beyond failure sites.

**Design decision 2026-08-06:** the boxholder does not want a separate
on-device bundle or share workflow. The box and its logs are the same privacy
space. Complete this issue by regularly uploading selected state transitions
and useful browser media failure metadata through the existing forwarder. Do
not add a second journal, export renderer, share sheet, or export-specific
scrubbing. Active design:
`../../beebox/docs/implemented-plans/ios-diagnostic-forwarding-completion.md`.

## Manual verification

On a physical iPhone, open a paired box, background and foreground the app, and
exercise speech playback. If practical, trigger a rejected media playback. Then
inspect the box's `.beebox/client-debug.log`. Confirm that it contains
timestamped `[ios]` scene, navigation, speech, response, and audio-session lines.
Confirm that media failures include the operation, error name or media error
code, network state, and ready state, with symbolic labels rather than bare
numbers. Leave the phone offline long enough for a
navigation retry, then reconnect and confirm that retries did not flood the log.

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
