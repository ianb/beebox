---
title: "iOS box screen: show the page title for a Clerk send, and retry by id"
workstream: clerk-quick-send
resolution: implemented
area: ios-app
labels: [quick-chat, ios, clerk]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-clerk-quick-send — cross-model plan review
---

**Closed:** The native box screen shows `page.title` as a link and retries through `quickChat.retry` (falls back to submit on a box without it). Resolved in a4211d882. Not verified: tapping the link to open Safari; a physical phone.

A page sent from the Clerk with no note becomes a quick chat record with an
empty message and a `page: { title, url }` field
([plan](../../../beebox/docs/implemented-plans/clerk-quick-send.md)). The web box screen
shows the page title. The native box screen shows only `message`, so the row
is blank, and several such rows cannot be told apart when the person must
choose a destination.

Retry also fails: the native box screen resends the message to
`quickChat.submit` (`ios-app/BeeBox/Storage/BoxScreenStore.swift:315`), which
requires a non-empty message
(`beebox/src/webapp/trpc/routers/quick-chat.ts:23`). The web box screen uses
`quickChat.retry({ id })` instead.

The boxholder chose web-only for the first version (2026-10-15). To fix:
decode and show `page.title` (linked to `page.url`) in the native row, and
retry through `quickChat.retry`. Use the bbx-ios-overlap skill: the view
shape is in [mobile contract §5.11](../../../beebox/docs/mobile-contract.md).
