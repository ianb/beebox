---
title: "iOS bridge message handler: routing and origin checks have no test"
workstream: unattached
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
`allowedOrigin` before decoding. No test calls it.
`ios-app/BeeBoxTests/ChatWebViewRequestTests.swift` decodes the payload types
directly and exercises the emission and receipt logic. A change that drops an
origin check, or routes a channel name to the wrong decoder, passes the suite.

`WKScriptMessage` cannot be constructed in a test, which is why the handler is
untested. The direction: pull the routing into a pure function that takes
`(name, isMainFrame, frameURL, body)` and returns the action, keep the
`WKScriptMessage` unpacking as a thin wrapper, and test the function with one
case per channel plus a wrong-origin, a subframe, and a malformed body. Do it
with the next change to that file, not as a standalone refactor.

Re-reviewed 2026-10-30: the body says every message is frame- and origin-checked before decoding, but only two of eleven channels are. Whether the other nine need the check (e.g. beeboxComposerCommand from a subframe) is a question to settle before writing the routing tests.

Out of date in the body above: Correct the mechanism: the handler checks main frame and origin only for beeboxComposerBinding, and origin only for beeboxSession; nine channels have no check. Add a question whether subframe/cross-origin messages on those channels are reachable (navigation policy at :546) and should be refused.
