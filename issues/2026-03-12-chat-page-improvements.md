---
area: callback-box
---

# Chat page improvements

Several things for the chat page:

- **Image paste**: pasting images into the chat input — **IMPLEMENTED**.
- **Camera capture in chat input**: live photo capture (not just paste/file-attach) from the composer. Still pending.
- **Max width**: chat page max-width constraint and general layout cleanup — **IMPLEMENTED**.
- **Rich text input**: consider using TenTap (or similar) for message composition.
- **Capture-from-chat flow**: add a "Capture" item to the chat composer's `+` menu (alongside Camera and Attach file). Selecting it runs a capture session, then returns to chat with a message announcing the capture has been added — referencing what was captured, not the content itself.
