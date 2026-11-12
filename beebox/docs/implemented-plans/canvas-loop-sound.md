---
title: "canvas-loop: sound as a view of state"
status: implemented
workstream: canvas-brushes
issues: []
---
# canvas-loop: sound as a view of state

canvas-loop sketches cannot make sound. This plan adds sound as data beside
`draw`. An optional `sound(model, p)` export returns sound occurrences
(voices), each with an id and a start frame. The runtime collects them after
every simulation tick. One deterministic synthesizer turns voices into
samples. A headless run writes the same WAV bytes every time, and a run
replayed from the beginning sounds the same. Scrubbing to a frame is not in
this version.

**Issues addressed:** none filed. Searched `issues/` for "sound" and "audio":
no canvas-loop items.

## Design

No design section: this is a developer API in an experimental sandbox. The
boxholder asked for it ("I'd like to incorporate sound") and set the shape:
"Would the sound be... deterministic and time-travelable? Or just events
emited that play outside the rest of the state system", with a guitar-string
pluck as the example they imagined. The boxholder will review the design
choices after this first version ("we might discuss how you chose to do it
tomorrow").

## Smallest fix and budget

**Smallest fix:** sound events emitted from `update`, played by the browser
with WebAudio oscillators. Events from a deterministic fold replay fine; the
gap is that headless runs cannot hear or check them, and oscillator playback
differs between runtimes. The chosen design keeps the occurrence idea and
adds deterministic samples both runtimes share.

**Chosen design:** one track, about 600 lines of source, 250 of tests, one
gallery example (~250) and ~100 lines of docs. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **TEA (boxholder: "I like TEA, so yeah, keep it"):** sound is a pure function
  of the model, beside `draw`, so `update` stays the only place state changes.
- **Determinism** (README: re-runs reproduce exact pixels): the synth uses
  seeded noise and a fixed sample rate; WAV bytes are reproducible.
- **"I don't want to just jump into doing physics"** (boxholder): the pluck
  is a synthesized string sound (Karplus–Strong); the drawn string's motion is
  a simple decaying sine in the example, not a physics engine.
- **Minimize invented concepts** (boxholder memory): one new noun (Voice) and
  one optional export.

## What already exists

- TEA module contract: `TeaModule` at `canvas-loop/src/core/tea.ts:243-249`
  (`init`, `update`, `draw`). **Extend** with optional `sound`.
- Loader: `toTeaModule` in `canvas-loop/src/headless/tea-load.ts` reads named
  exports. **Extend** to read `sound`.
- Headless frame loop: `canvas-loop/src/headless/tea-runtime.ts` `#runFrame`.
  **Extend:** call `sound` after `draw`.
- Output writer: `FrameRecorder.writeOutput`
  (`canvas-loop/src/headless/recorder/frame-recorder.ts:166`). **Extend:** write
  `sound.wav` and a waveform strip PNG when the run made sound.
- Seeded PRNG: `canvas-loop/src/core/prng.ts` (`SeededRandom`). **Reuse** for
  pluck noise, seeded per voice from its id.
- Browser runtime: `canvas-loop/src/browser/runtime/engine.ts` `#draw`.
  **Extend:** call `sound`, hand new voices to a player.

## Prior art (external)

- Karplus & Strong, "Digital Synthesis of Plucked-String and Drum Timbres"
  (Computer Music Journal, 1983): a noise burst through a delay line with an
  averaging filter. Adopted as the pluck algorithm (a published algorithm, no
  code copied); ACKNOWLEDGEMENTS.md gets an entry in the chunk that lands it.
- Elm/React "view as a function of state" applied to audio: e.g. the
  declarative WebAudio wrappers (react-music, Tone.js `Part` with explicit
  times). Evaluated-only; the voice-list-with-start-time shape is the same idea.

## Ontology

- **Voice** (new, `canvas-loop/src/core/sound/voice.ts`): one sound
  occurrence, as data: `{ id, at, kind, ... }`. `id` is a string the sketch
  chooses, unique per occurrence; `at` is the frame it starts on. It is NOT a
  running oscillator and NOT editable state.
- **Voice kinds:** `pluck` (`freq`, `gain?`, `decay?` seconds, `brightness?`
  0..1), `tone` (`freq`, `gain?`, `duration` seconds, `wave?`
  sine/triangle/square, attack/release fixed short), `noise` (`gain?`,
  `duration`, a short click or swish).
- **`sound` export:** `sound(model, p): readonly Voice[]`, pure, called after
  every tick's fold. It returns the voices the model holds (recent and
  upcoming); returning a voice again is harmless.
- **Score** (new, internal): the run's voices by id. Headless renders it to
  samples; the browser plays each voice when its frame runs.

## Tracks / scope

### Track A: sound

- **What:** the `sound` export, the synth, headless WAV output and a waveform
  view, browser playback, and a guitar-string example.
- **Why:** the boxholder asked for sound that is deterministic and replayable.
- **Direction:**
  - `canvas-loop/src/core/sound/synth.ts`: `renderVoice(voice, sampleRate)`
    returns a `Float32Array`; `mix(score, { frames, fps, sampleRate })` returns
    the run's samples. Sample rate 44100. Pluck noise seeded from a hash of the
    voice id.
  - **Voices are occurrences.** An id names one sound. A pluck that happens
    again needs a new id (a counter in the model). Re-declaring an id with
    the same data is harmless; with different data it is an error naming the
    id. Removing a voice from the list does not stop it.
  - **No backdating.** A voice first declared on frame N must have `at ≥ N`;
    an earlier `at` is an error. So a longer run never changes earlier audio.
  - **Collected per tick.** Both runtimes call `sound(model, p)` after each
    tick's fold (after the events and the tick of frame N), not after `draw`.
    The browser runs several ticks per animation frame when it catches up;
    collecting per tick keeps the score the same as headless.
  - **At most 32 new voices per frame**; more is an error.
  - **Mixing:** voices are summed and clipped at ±1, which is what the
    browser's audio output does. Keep gains so sums stay under 1.
  - Headless: after a run with any voice, write `out/sound.wav` (16-bit mono)
    and `out/sound.png` (a waveform strip with a mark at each voice start), and
    a transcript line per voice start: `frame 40: sound pluck "string-3" 196 Hz`.
  - Browser: a `SoundPlayer` renders a voice with the same `renderVoice` into
    an `AudioBuffer` and starts it when the runtime reaches its `at` frame
    (no scheduling ahead on the audio clock, so pause, catch-up and
    discarded time cannot drift). Pause lets sounding tails finish; restart
    stops everything. Browsers start audio only after a user gesture: the
    first pointer or key press on the figure enables sound before that
    input is dispatched, so its own sound plays. Voices before that are
    skipped and logged once ("sound starts after the first click").
  - Example `canvas-loop/src/gallery/guitar-strings/`: six strings; drag across
    a string to pluck it (mousedown/mousemove crossing); the string vibrates
    visibly with a decaying amplitude; a param chooses the tuning.
- **Vocabulary lock-ins:** `sound` export; `Voice` with `id`, `at`, `kind`;
  kinds `pluck`, `tone`, `noise`.
- **First implementation chunk:** types, `renderVoice` for the three kinds,
  `mix`, WAV encoder, tests for determinism and score rules.

## Could this be simpler?

- **Events from `update`** (the smallest fix): fails determinism and replay.
- **Only headless WAV, no browser playback:** the person could not hear the
  interactive. Browser playback is ~120 lines reusing `renderVoice`.
- **A streaming synth (oscillators, an audio graph):** more expressive, but
  the output then depends on scheduling; precomputed buffers per voice keep
  both runtimes identical. Long or continuous sounds are deferred (NOT in scope).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Same id returned with different data | new: score test | `SketchUsageError` naming the id | clear |
| New voice with `at` before the current frame | new: score test | `SketchUsageError` | clear |
| Browser batches several ticks per animation frame | new: browser runtime test (score equals headless) | sound collected per tick | clear |
| `freq` 0, negative or NaN; `duration` huge | new: validation test | `SketchUsageError` naming the voice id and key; duration capped at 10 s | clear |
| Many overlapping voices clip | new: mix test | sum clipped at ±1, as WebAudio does | audible distortion, documented |
| A flood of voices | new: score test | at most 32 new voices per frame | clear |
| Browser plays nothing before a user gesture | — | the first gesture enables sound before its input is dispatched; earlier voices skipped and logged once | clear (log) |
| `sound` export throws | existing frame error path | runtime reports the error like `draw` | clear |
| Two runs differ in WAV bytes | new: determinism test | seeded noise, no wall clock | clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Agent emits a voice every frame with a new id:** ADDRESSED: each id is a
  new sound; the transcript lists each start, so a flood is visible.
- **Agent keys the id on the frame but wants one sound:** ADDRESSED by docs:
  "the id names the sound; reuse it".
- **Hearing in headless:** an agent cannot listen; the waveform PNG and
  transcript lines are how it checks timing and loudness.
- **Validation error UX:** messages name the voice id and the key.
- **Stale ref, two writers, hand-edit drift, transition state:** not applicable.

## NOT in scope

- Continuous or long sounds (drones, music loops), effects (reverb), stereo.
- Sound driven by physics simulation.
- Sound in the React figure (it uses the same runtime, so it may work; not tested).
- Microphone input.

## Open design questions

- **Scrubbing** (seek to a frame and hear from there) needs replay-to-frame
  and tail reconstruction; deferred. Human decision.
- **Occurrences versus editable voices** (a sustained voice whose pitch follows
  the model): this version only has occurrences. Human decision.

- Whether `sound` should be a separate export or part of `draw` (`v.sound(...)`).
  Lean: separate export, so `draw` stays pictures and a sound-only change does
  not touch drawing; the boxholder will review this choice.

## Knowledge audits

Skipped: canvas-loop is dev tooling, not box-agent guidance.

## What will hold this after it ships

- Unit tests: `renderVoice` determinism per kind; score rules (conflicting id, backdating,
  kept, future `at`, past `at`); mix peak; WAV header bytes; transcript lines.
- `gallery check` runs the example (WAV bytes are part of the output compared
  for determinism).

## Implementation order

1. Types, synth, mix, WAV encoder, tests.
2. Headless: loader, runtime, recorder outputs (WAV, waveform PNG, transcript).
3. Browser: `SoundPlayer`, runtime hook, restart.
4. Guitar-strings example and an exhibit.
5. Docs (TEA.md section, CHANGELOG), ACKNOWLEDGEMENTS entry, cross-model review.

## Rollout shape

- Tests first: `test/core/sound/synth.test.ts`, `test/headless/tea-runtime.sound.test.ts`.
- Done when those pass, typecheck/lint/layout-check pass, `gallery check` passes
  with the example, and the example plays in a browser after a click.
