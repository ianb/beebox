---
title: "Spoken overview of a card or landmark: a cited script read in the box's voice, saved as audio"
workstream: unattached
area: beebox
needs: [design]
labels: [voice, competitive-research, courseware]
filed-by: agent
discovered-by: agent
discovered-in: worktree-notebooklm-research — comparing Gemini Notebook's Audio Overview with the box's TTS
---

A person wants to listen to a document, a scan, or a place's main cards while
doing something else: the chemistry learner on the way home, a scanned letter
read aloud, a landmark's week in a few minutes. Gemini Notebook's Audio
Overview is the feature people name most for it
([research](../../research/notebooklm/comparison.md#audio)); its failures
are one tone for everything, nothing citing back to a passage, and glitches
in the interactive mode.

The box speaks only chat replies today (`beebox/src/webapp/routes/chat/audio-routes.ts`).
Nothing produces audio from a card, and nothing saves audio. The personality
card already gives a box a voice and a speaking style, which is the thing the
Notebook audio lacks.

## What it would take

- **v1, one voice.** A `bbx` command or a procedure: given a card path or a
  landmark, the agent writes a spoken script as a `doc` card with
  `{% source %}` anchors into the cards it summarizes; the command renders
  the script through the existing TTS service
  (`beebox/src/core/tts/resolve.ts`) and files the MP3 as an `audio` card
  beside the script. All pieces exist; the new code is the command, chunking
  long scripts into clips, and the audio-card write. The transcript cites,
  which Notebook's audio does not.
- **v2, two voices.** The Gemini model the box already calls
  (`gemini-3.8-flash-lite-tts`, `beebox/src/services/tts.ts:326-370`)
  accepts up to two prebuilt-voice speakers in one request: each turn carries
  `speech_metadata: {speaker, style}` and `speech_config` becomes
  `{speakers: [{speaker, voice}, …], mode: "conversational"}` (Google
  speech-generation docs, read 2026-10-09). That is a change inside
  `createGeminiTts`, not a new backend. The OpenAI backend has no equivalent;
  v2 is Gemini-only and the picker should say so.
- **Interactive join** (ask a question mid-playback) is what a voice chat
  already is; nothing to build.

## Design questions

- Where the audio lives: beside the script in its attach scope, or in the
  landmark's attach scope, and whether the place page lists it.
- Whether the script is the box's voice alone (v1) or the box plus one guest
  (v2), and who the guest is: a named second voice from the personality card,
  or a style the person picks.
- Length control: Notebook offers Shorter / Default / Longer; a script length
  in words is the honest control.
- iOS: playback of a saved audio card in the companion app, which plays TTS
  in the WebView today.

Nothing in the journeys asked for this; the chemistry journey
(`beebox/test/user-stories/journeys/D-chemistry/`) is the nearest fit. If
built, the landing commit adds Gemini Notebook to `ACKNOWLEDGEMENTS.md`.
