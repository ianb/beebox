---
title: "iOS Share Sheet capture via native extension"
workstream: ios-share-extension-capture
area: callback-box
needs: [manual-testing]
design: ../../callback-box/docs/plans/ios-share-extension-capture.md
---

## Current design decision

This feature now uses a **native Share Extension** in the iOS app (`app.callbackbox.ios.share`).

The first implemented slice supports sharing from other apps to a selected paired box through:

- URL and text items,
- **Send to a chat** (direct message to a recent landmark chat),
- **Save in** (Inbox, or a landmark marked with `for: [share]`).

URL and text shares send as chat text when a chat destination is chosen.
URL saves use the same page-card shape used by Clerk page capture, with reduced metadata.

All paired boxes' non-secret metadata and the main app's selected-box id are stored in App Group
UserDefaults, while device tokens are stored per box in shared Keychain. The extension names the
current box and offers a picker when more than one box is paired; changing it affects only that
share action.

## Scope

- Native iOS app required (no PWA or Shortcut fallback in this feature).
- Defaults to the main app's selected box, with an explicit picker for other paired boxes.
- One item per share action.
- No full chat picker in v1.

## Implementation notes

Implemented via `callback-box/docs/plans/ios-share-extension-capture.md`.

Image/photo, audio, and file sharing remain follow-up work in that plan. The extension deliberately
does not advertise those types until capture staging supports exact chat and save targets.

## Scripted verification (manual-device)

> **⏳ Awaiting manual testing** — share a URL from Safari and selected text from another iOS app into a paired box. Confirm:
> 1) the sheet names the main app's selected box,
> 2) with two paired boxes, choosing the other box reloads its destinations without changing the
>    main app's selected box,
> 3) share to a chat lands in the selected chat as a chat message, and
> 4) share to "Save in" writes the expected card in Inbox or the selected `[share]` landmark in the
>    box named by the sheet.

Only Ian should clear `needs: [manual-testing]`.

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
