---
title: "iOS native send hangs forever (and loses the message) if the webview isn't loaded yet"
workstream: unknown
area: callback-box
resolution: implemented
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

Resolved by the durable pending-emission queue in `0e7549de`. A native send is
persisted before delivery, remains queued while the page is unloaded, and is
delivered with the same ID from `didFinish`; navigation clears only inflight
transport state and replays the durable pending emission. XCTest covers
navigation followed by same-ID redelivery and receipt timeout rejection.

`NativeComposerView.send` in `ios-app/CallbackBox/Views/NativeComposerView.swift` clears the typed
text and attached images and shows the sending spinner *before* delivery is attempted.
`Coordinator.deliver` in `ios-app/CallbackBox/Views/ChatWebView.swift` early-returns when
`!pageLoaded` — so if the page hasn't finished loading (app opened offline, box down or mid
cold-start, or a load error), the emission is silently dropped: no 35s receipt timeout gets scheduled
(that only happens inside `deliver`, which never runs), and there's no `didFail`/
`didFailProvisionalNavigation` WKNavigationDelegate handler anywhere in the file to catch this case
either.

Concrete failure: user types a message (or attaches photos) while the box is cold-starting, taps
send. The composer clears, shows "Sending to chat…" — and stays there permanently. The content is
gone from the input field, nothing is retried, nothing is rejected, and the only recovery is a manual
reload or navigation, which does not recover the lost message.

This is effectively the July-9 finding I3's failure mode resurfacing specifically in the
not-yet-loaded window (I3 itself is otherwise fixed for the loaded case via the real receipt-bridge
channel and 35s timeout).

Fix direction: schedule the receipt timeout at acceptance time independent of `pageLoaded`, and/or add
a `didFail*` delegate that rejects all inflight and pending native emissions so the composer can
restore the text/images (as it already does on an explicit `rejected` receipt).
