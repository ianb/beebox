---
title: "Automatic transcript handling in schema instructions"
workstream: unknown
area: callback-box
resolution: superseded
---

**Closed (2026-07-15): superseded.** Transcription isn't handled this way anymore
— the capture-mode rework (retired the old capture pipeline; Tracks 5/7) changed
how audio/transcription flow, so the premise (memo/audio/capture-session schema
*instructions* carrying transcription-state machinery) no longer describes the
system. Refile against the current capture pipeline if schema instructions still
leak transcription details.

Several card type instructions (memo, audio, capture-session) include details about transcription handling (checking for `<transcription>`, skipping untranscribed audio, etc.). This should ideally be handled automatically by the processing pipeline rather than requiring agents to understand transcription state. The schema instructions should focus on describing the card's content and structure, not transcription machinery.
