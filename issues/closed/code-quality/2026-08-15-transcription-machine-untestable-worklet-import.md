---
title: "realtimeTranscriptionMachine can't be doctested — worklet ?url import breaks the Node loader"
workstream: unattached
area: beebox
labels: [transcription, voice, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-transcript-confidence — adding words-with-confidence to the machine (Track 2)
priority: important
resolution: implemented
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


## Fixed 2026-09-12

Took the first suggested fix: the `?url` import in
`machines/transcription-mic.ts` is now a dynamic `await import(...)` inside
`startMic`, resolved at mic-start rather than at module load. Vite still
resolves it; Node only ever would if a test opened a microphone, which no
doctest does.

All three previously unimportable modules now load under the tap/tsx loader —
verified by importing each directly: `realtimeTranscriptionMachine.ts`,
`machines/transcription-actor.ts`, `hooks/useRealtimeTranscription.ts`.

And the missing coverage this issue asked for exists:
`test/frontend/transcription-machine.doctest.md` drives the machine with
scripted events instead of calling reducers by hand —

- `START` opens a fresh segment and records the target session;
- `TEXT_UPDATE` replaces the segment rather than appending (the actor owns
  accumulation);
- `finalWords` keeps `null` and `[]` distinct, which is the whole point of that
  field — no confidence data captured, versus a backend that reports words and
  found none;
- a `TRANSCRIPTION_DONE` carrying text replaces and clears the interim, while
  one carrying empty text KEEPS what was already final — the reconnect-shaped
  case the transcript must survive;
- and it ends the segment, which `transcriptionStateOf` reports as `idle`.

Two things the test had to get right, both recorded in it: the machine handles
`TEXT_UPDATE` only after `MIC_LIVE` then `WS_CONNECTED` (in `connecting`,
nothing is recorded yet, so the event is not handled at all), and every actor
must be stopped — the machine arms `after` timers for silence, max duration and
connect, and a live timer outlives the assertions.
