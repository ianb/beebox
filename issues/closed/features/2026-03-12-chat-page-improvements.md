---
title: "Chat page improvements"
area: callback-box
resolution: implemented
---

> **Closed 2026-08-06.** All concrete items shipped or dropped: image paste + max-width
> IMPLEMENTED; camera capture + capture-from-chat are in the composer
> (`InteractiveChat-composer.tsx` — `[capture] [camera]`, the `+` menu capture item);
> rich-text input (TenTap) is **wontfix** (boxholder: not doing it). The one live idea
> — capturing feedback FROM a chat (not just cards) — is split out to
> [capture-feedback-from-chat](../../features/2026-08-06-capture-feedback-from-chat.md).

Several things for the chat page:

- **Image paste**: pasting images into the chat input — **IMPLEMENTED**.
- **Camera capture in chat input**: live photo capture (not just paste/file-attach) from the composer. Still pending.
- **Max width**: chat page max-width constraint and general layout cleanup — **IMPLEMENTED**.
- **Rich text input**: consider using TenTap (or similar) for message composition.
- **Capture-from-chat flow**: add a "Capture" item to the chat composer's `+` menu (alongside Camera and Attach file). Selecting it runs a capture session, then returns to chat with a message announcing the capture has been added — referencing what was captured, not the content itself.
