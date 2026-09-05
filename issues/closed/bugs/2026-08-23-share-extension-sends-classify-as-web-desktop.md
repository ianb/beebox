---
title: "iOS Share Extension chat sends are classified as web-desktop"
workstream: small-bugs-batch
area: ios-app
filed-by: agent
discovered-in: worktree-points-at-ui — while making the chat `channel` client-sent
priority: important
resolution: implemented
---

Closed 2026-08-29 by this commit (`fix(ios): classify share-extension sends as native`): share sends now include `channel: "ios-native"`, with contract documentation and XCTest coverage.

`ShareExtensionAPI.swift:84` posts to `/api/chat/send` without a `channel`
field, so the route falls back to classifying the User-Agent — and a
`CFNetwork` UA matches none of `mobi|android|iphone|ipad`, so the send lands
in the `<chat-app>` snapshot as `channel="web-desktop"`. The agent then
shapes a reply for a wide screen for a message that came from a phone's
share sheet.

Harmless today (nothing acts on it beyond reply length and table width) and
unchanged by the `channel` work — it only became visible once the union was
closed. The fix is for the extension to send `channel: "ios-native"`
(contract row S3 in `docs/mobile-contract.md` §5.5), which belongs with the
Track 5 remainder of
[agent-points-at-ui](../../../beebox/docs/plans/agent-points-at-ui.md).
