---
title: "realtimeTranscriptionMachine can't be doctested — worklet ?url import breaks the Node loader"
workstream: unattached
area: beebox
labels: [transcription, voice, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-transcript-confidence — adding words-with-confidence to the machine (Track 2)
---

No doctest can import `realtimeTranscriptionMachine`, `transcription-actor.ts`,
or `useRealtimeTranscription`. Importing any of them transitively pulls in
`src/frontend/src/machines/transcription-mic.ts`, which has a static
`import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url"` — a
Vite-only asset import the tap/tsx doctest loader cannot resolve, so the
module fails to load under Node.

Consequence: the machine's `assign` reducers (`applyTextUpdate`,
`setFinalTranscript`, `clearTranscript`) and the actor's reconnect
`committedPrefix` folding are exercised only by typecheck. The
transcript-confidence work (Track 2) wanted a machine-level doctest with
scripted `TEXT_UPDATE`/reconnect events and had to settle for pure-function
tests (`test/frontend/transcription-merge.doctest.md`,
`transcription-connections-words.doctest.md`) instead.

Likely fix: make the worklet import lazy/dynamic in `transcription-mic.ts`
(resolve the URL at mic-start time), or isolate it behind a module the machine
does not statically depend on. Then add the missing machine-level doctest.
