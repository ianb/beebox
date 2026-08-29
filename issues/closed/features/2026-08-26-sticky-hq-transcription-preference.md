---
title: "Sticky HQ transcription preference — turning HQ dictation on shouldn't be a per-chat ritual"
workstream: transcript-confidence
area: callback-box
labels: [voice, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "sticky hq transcription preference"
resolution: implemented
---

Closed by `6410124b5`: box and landmark defaults now seed new chats with explicit chat override, using chat > landmark > box > built-in off precedence. Parent-scope edits do not change an open chat.

HQ dictation is a chat feature flag: `hq-dictation` in
`src/core/chat/features.ts` (server is the source of truth, per session, with
a registry default), read at `use-chat-model.ts:216` and toggled per chat.
A boxholder who always wants the HQ pass (`POST /api/chat/transcribe-audio` →
the configured HQ transcriber, vs the Voxtral realtime stream) has to re-enable
it in every new chat.

Make the preference sticky. Design choices, since the feature system already
offers levels:

- **Where the sticky value lives.** The feature registry has per-feature
  defaults, and landmarks seed features — so the natural options are a
  box-level default (box config, like `agentModel`), a landmark-level seed, or
  a per-device preference (localStorage; wrong if the preference is really
  about the boxholder, right if it's about the device's mic/bandwidth).
  Box-level default with per-chat override is the shape the model picker just
  established (`model-engine-policy`); following it keeps one pattern.
- **Precedence.** registry default < box default < landmark seed < explicit
  per-chat toggle — and whether an agent `<chat-app>` delta can flip it.
- Narration mode (`narration` flag, same file) has the same per-chat reset;
  decide whether it rides along or is deliberately per-chat.
