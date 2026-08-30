---
title: "Sticky HQ transcription preference — turning HQ dictation on shouldn't be a per-chat ritual"
workstream: transcript-confidence
area: beebox
labels: [voice, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "sticky hq transcription preference"
needs: [manual-testing]
---

Web support landed in `6410124b5`, but physical-device testing found that the
iOS native composer did not receive or honor the HQ state. Keep this open until
the native Send button and spoken-send paths are bridged and verified.

HQ dictation now has the agreed scope controls: a per-chat value by default,
plus adjacent landmark and box defaults with explicit inheritance. The server
resolves the effective value and remains the source of truth.

The remaining gate is native iOS verification. The web setting, native Send
button, and spoken-send path now share that resolved value; native HQ results
also carry provenance so the persistent `HQ` marker is evidence of the pass,
not merely the client's intent.

## Manual testing

- Install a build containing the native bridge changes, then force-quit and reopen it.
- In a fresh chat, set `Chat: on`, dictate a normal message, and tap Send. Confirm the message keeps the microphone stopped and shows the subtle `HQ` provenance marker.
- Set `Chat: off`, dictate and tap Send, and confirm there is no `HQ` marker.
- Set `Chat: on` again, dictate and say the ordinary send keyword, and confirm the resulting message shows `HQ`.
- Start a brand-new chat while an inherited landmark or box setting resolves to on, then repeat the button test to cover session assignment.
