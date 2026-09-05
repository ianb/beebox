---
title: "Speech playback timing"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed 2026-07-11:** already fixed by commit d9540393 (2026-04-16, "Stream chat
TTS: speak segments as `</speech>` closes") — segments dispatch to the playback
machine mid-stream as each `</speech>` closes
(`src/frontend/src/components/chat/InteractiveChat-speech.ts:61`), so speech-first
works as intended.

Currently TTS speech doesn't play until the full response is complete (or at least a significant chunk). This means the "speak before doing work" pattern in the chat system prompt doesn't actually work as intended — the user hears the speech and sees the results at the same time, not speech-first. Investigate whether streaming partial speech playback is feasible so the user hears "Let me look into that" before tool calls start executing.
