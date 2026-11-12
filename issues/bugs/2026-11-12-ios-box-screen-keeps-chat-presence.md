---
title: "iOS: a person on the native box screen still shows as present in their last chat"
workstream: unattached
area: beebox
labels: [chat, multi-user, presence, ios]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-chat-presence — cross-model plan review, 2026-11-12"
---

Chat presence (`beebox/docs/chat-presence.md`) counts the iOS web view as
present while its page is visible. When the person switches to the native box
screen, the app keeps the web view mounted at opacity 0
(`ios-app/BeeBox/Views/RootView.swift`, `boxContent`: `.opacity(shown ? 1 : 0)`),
so `document.visibilityState` stays `visible`. Other people in the chat keep
seeing this person's head until the app goes to the background.

The fix needs a native→web signal that the web surface is hidden or shown
(for example a `beebox:native-surface` event, like the other `CustomEvent`s
`ChatWebView.swift` dispatches), recorded in `beebox/docs/mobile-contract.md`,
and a device check. The boxholder asked to avoid a bridge change for presence
if web signals sufficed; they do not for this case.

Also unverified on a device: that backgrounding the app sets the page hidden
(the fallback is the WebSocket keep-alive, about 35 seconds).
