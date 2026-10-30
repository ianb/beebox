---
title: "iOS bridge message handler: routing and origin checks have no test"
workstream: ios-bridge-origin
area: ios-app
labels: [ios, tests, bridge]
priority: normal
filed-by: agent
discovered-in: worktree-app-shell — iOS testing review for beebox/docs/plans/mac-app-shell.md
---

`ChatWebView.Coordinator.userContentController(_:didReceive:)`
(`ios-app/BeeBox/Views/ChatWebView.swift:591`) dispatches every web-to-native
message. It branches on `message.name`, then checks
`message.frameInfo.isMainFrame` and that the frame's origin equals
`allowedOrigin` before decoding. No test calls it. (Corrected 2026-10-30: that
check covered only `beeboxComposerBinding`; `beeboxSession` checked the origin
of its body URL, and nine channels had no check.)
`ios-app/BeeBoxTests/ChatWebViewRequestTests.swift` decodes the payload types
directly and exercises the emission and receipt logic. A change that drops an
origin check, or routes a channel name to the wrong decoder, passes the suite.

`WKScriptMessage` cannot be constructed in a test, which is why the handler is
untested. The direction: pull the routing into a pure function that takes
`(name, isMainFrame, frameURL, body)` and returns the action, keep the
`WKScriptMessage` unpacking as a thin wrapper, and test the function with one
case per channel plus a wrong-origin, a subframe, and a malformed body. Do it
with the next change to that file, not as a standalone refactor.

Settled 2026-10-30: no web code posts from a subframe, so every channel now
refuses anything but the box's main frame. The routing lives in
`Coordinator.receiveBridgeMessage`, tested per channel in
`ChatWebViewBridgeTests`.
