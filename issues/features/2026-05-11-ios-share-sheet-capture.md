---
title: "iOS Share Sheet capture via native extension"
area: callback-box
needs: [manual-testing]
design: ../callback-box/docs/plans/ios-share-extension-capture.md
---

## Current design decision

This feature now uses a **native Share Extension** in the iOS app (`app.callbackbox.ios.share`).

The first implemented slice supports sharing from other apps to a selected paired box through:

- URL and text items,
- **Send to a chat** (direct message to a recent landmark chat),
- **Save in** (Inbox, or a landmark marked with `for: [share]`).

URL and text shares send as chat text when a chat destination is chosen.
URL saves use the same page-card shape used by Clerk page capture, with reduced metadata.

The shared selected-box metadata is stored in App Group UserDefaults, while device tokens are stored in shared Keychain.

## Scope

- Native iOS app required (no PWA or Shortcut fallback in this feature).
- One selected box only.
- One item per share action.
- No full chat picker and no box picker in v1.

## Implementation notes

Implemented via `callback-box/docs/plans/ios-share-extension-capture.md`.

Image/photo, audio, and file sharing remain follow-up work in that plan. The extension deliberately
does not advertise those types until capture staging supports exact chat and save targets.

## Scripted verification (manual-device)

> **⏳ Awaiting manual testing** — share a URL from Safari and selected text from another iOS app into a paired box. Confirm:
> 1) share to a chat lands in the selected chat as a chat message, and
> 2) share to "Save in" writes the expected card in Inbox or the selected `[share]` landmark.

Only Ian should clear `needs: [manual-testing]`.
