---
title: "canvas-loop: instruments, a sample library, and sound guidance"
status: active
workstream: canvas-brushes
issues: []
---
# canvas-loop: instruments, a sample library, and sound guidance

Subplan of [canvas-brushes.md](canvas-brushes.md). Figures written by box
agents make poor sounds. The agent cannot hear, and canvas-loop gives it three
raw primitives: a plucked string, a plain tone, and a noise burst. The
boxholder asked (2026-11-12): "do add some instruments and guidance, and a
sound library for things like chimes if possible". This plan adds named
recorded sounds the agent picks by meaning, a few synthesized instruments that
play named notes, and guidance on using them.

**Issues addressed:** none filed. Searched `issues/` for sound, audio, voice,
synth, chime: only voice-note and dictation items, none about figures.

## Design

No design section: canvas-loop is a developer library. A person meets the
result only as better sounds in a figure. The boxholder already settled the one
person-facing behaviour in this area: sound still starts only after a user
gesture on the figure (a tap, click, key press or control change, as now) ("maybe for now it's safer to require a tap in that case too").

## Smallest fix and budget

**Smallest fix:** guidance only (gains, sparse events, no square tones). It
does not fix the problem: with three primitives, a "ding" is still a sine beep.

**Chosen:** two new voice kinds, a generated sample data module, a build
script, guidance, one example, and a listening exhibit for the boxholder.

| Part | Source lines | Test lines |
|---|---|---|
| `note` voice: instruments and note names (`synth`, `instruments.ts`) | 150 | 60 |
| `sample` voice: catalog, decode, resample, validation | 150 | 60 |
| Library build script (ffmpeg, trim, normalize, μ-law, base64) | 120 | 0 |
| Browser player: lazy library load | 40 | 30 |
| Example sketch | 80 | 0 |
| **Total** | **~590** | **~150** |

Authored docs: about 80 lines (TEA.md Sound section, CHANGELOG,
ACKNOWLEDGEMENTS). Generated: one data module, about 1 MB of base64 text,
excluded from lint and from line counts.

## Stated preferences this plan trades against

- **Determinism** (`canvas-loop/README.md`, the package's reason to exist): the
  headless WAV and browser playback must be the same samples. This rules out
  decoding Ogg or MP3 at run time with the browser's `decodeAudioData`, whose
  output differs between browsers. The plan decodes once, at build time, and
  commits PCM.
- **"Minimize invented concepts; prefer primitives"** (boxholder feedback):
  samples and notes stay voices, under the existing `sound()` contract and the
  existing `Score`. No second sound API.
- **Bundle cost:** every figure loads the canvas-loop browser chunk
  (`beebox/src/frontend/src/components/FigureView/FigureMount.tsx:69`,
  `import("@ianbicking/canvas-loop/browser")`). The sample data is a separate
  lazy chunk, loaded only by a sketch that exports `sound`.

## What already exists

- Voice contract and validation: `canvas-loop/src/core/sound/voice.ts`
  (`assertVoice`, `Score`, `KEYS` per kind). Reuse: add two kinds.
- Renderer: `canvas-loop/src/core/sound/synth.ts`, `renderVoice(voice,
  sampleRate)` with a `switch` on `voice.kind`; `mix` for the headless track.
  Reuse.
- Browser player: `canvas-loop/src/browser/runtime/sound-player.ts`, `play(voice)`
  renders with `renderVoice` and starts a buffer. Reuse; add library loading.
- Headless files: `canvas-loop/src/headless/recorder/sound.ts`, `soundFiles`
  writes `sound.wav` and `sound.png`. Reuse unchanged apart from passing the
  library.
- Docs: `canvas-loop/TEA.md` "## Sound" section. Rewrite.
- Figure guidance points at the drawing API docs:
  `beebox/src/schemas/figure.ts:182` ("**The drawing API** (\`View\`, styles,
  text, scopes, input, sound) is in"). No change needed there beyond the docs
  it points to.
- Acknowledgements: `ACKNOWLEDGEMENTS.md` has a Karplus–Strong entry and a
  section for redistributed licensed assets.

## Prior art (external)

- Kenney audio packs (kenney.nl), CC0, each zip with a `License.txt` stating
  "Creative Commons Zero, CC0". Downloaded 2026-11-12: Interface Sounds, Impact
  Sounds, UI Audio, Digital Audio, RPG Audio, Casino Audio, Music Jingles,
  about 600 Ogg files, mostly 0.1–1.5 s. **Adopted** (redistributed subset);
  ACKNOWLEDGEMENTS entry lands with the library chunk.
- Modal (additive) synthesis of struck bars and bells: a sum of decaying sine
  partials at measured ratios (marimba bar ≈ 1 : 3.9 : 9.2; bells inharmonic).
  Textbook technique (e.g. Perry Cook, *Real Sound Synthesis for Interactive
  Applications*, 2002). **Adopted** as the struck instruments.
- Two-operator FM electric piano (Chowning, 1973 FM synthesis; the DX7 "E.Piano"
  patch is the well-known instance). **Adopted** for `epiano`.
- General MIDI sample sets (FluidR3, MusyngKite) were **evaluated only**: CC-BY
  or CC-BY-SA, several MB per instrument. Synthesis covers tuned instruments at
  no size cost.

## Ontology

- **Voice** (exists, `voice.ts:7` `VoiceBase`, `voice.ts:42` `Voice`): one sound occurrence with `id`, `at`,
  `gain`. Two new kinds join `pluck`, `tone`, `noise`.
- **Sample voice** (`kind: "sample"`): plays one recorded sound from the
  library. Keys: `name` (a catalog name), `variant` (integer, default 0, taken
  modulo the name's variant count), `rate` (0.5–2, default 1; playback speed,
  which also shifts pitch). Not a file path: the agent cannot load its own
  audio.
- **Sample name**: a word naming what a sound means or is (`chime`, `click`,
  `pop`, `step-grass`). One name has 1–5 recorded variants.
- **Library**: the decoded samples, keyed by name. Loaded once per process
  (headless) or per page (browser).
- **Note voice** (`kind: "note"`): one note on a synthesized instrument. Keys:
  `instrument`, `note` (a name like `"C4"`, `"F#5"`), `duration` (seconds;
  how long a held instrument sounds; a struck instrument rings its own length
  unless `duration` cuts it). Not `freq`: a named note keeps the agent in tune.
- **Instrument**: `marimba`, `bell`, `kalimba`, `epiano`, `pad`.
- **Scale helper** `scaleNote(step, {root, scale})`: returns a note name; `scale`
  is `pentatonic` (default), `major` or `minor`. Maps a count or a value to
  scale steps; pentatonic steps sound well together.

## Tracks / scope

1. **Instruments.** `synth.ts` gains `note` rendering through a new
   `instruments.ts`. Each instrument is a pure function of (frequency,
   duration, sample rate). Struck instruments are modal; `epiano` is two-op FM;
   `pad` is detuned saws softened by a one-pole low-pass, with a slow envelope. Note names parse in one function with
   a clear error.
2. **Sample library.**
   - The selected Kenney Ogg originals are committed under
     `canvas-loop/sounds/kenney/` with their License.txt, so the library
     rebuilds from the repository alone.
   - `canvas-loop/scripts/build-sound-library.ts`: reads those originals and a hand-written catalog (name → source files), runs ffmpeg
     to mono 22 050 Hz, trims leading and trailing silence, normalizes each
     variant to one peak level, encodes 8-bit μ-law, writes
     `src/core/sound/library/bundled.generated.ts` (base64 strings, one line per
     name, formatted so it passes lint with no ignore entry) and a size report.
   - `src/core/sound/library/catalog.ts`: names and variant counts only (no
     data), so validation and docs need no data.
   - `src/core/sound/library/decode.ts`: μ-law → Float32, linear resample to
     the output rate times `rate`.
   - Target library: about 30 names, at most 25 s total audio (about 550 KB,
     about 740 KB as base64).
3. **Loading.** `renderVoice(voice, sampleRate, library?)`. A `sample` voice
   without a library throws an internal error in headless (always loaded there)
   and is skipped in the browser.
   - Headless: the recorder and runtime import the data module statically.
   - Browser: `attachSketch` starts `import()` of the data module when the
     sketch exports `sound`, so it loads while the figure is first on screen. A
     sample voice that arrives before it resolves waits in the player and starts
     when the data arrives, if that is within 0.25 s of its due time; later, it
     is dropped and the figure's sound log says so. A failed load logs once and
     other voices play.
   - The canvas-loop esbuild IIFE builds (playground, dev demo) inline the
     data; they are dev tools and the cost is accepted.
4. **Guidance.** TEA.md Sound section: a table of events to sounds (success,
   mistake, select, drop, collect, step, ambient), the instrument list with
   when to use each, `scaleNote`, and rules: gains 0.2–0.4 when sounds
   overlap, one sound per meaningful event, never a sound per frame, held tones
   short, silence is fine. Plus the full name list, generated from the catalog
   and checked by a test so it cannot drift.
5. **Example and exhibit.** The exhibit comes before the guidance is final, so
   the boxholder can rename or drop sounds by ear. `src/examples/sound-tea.ts`: tap a bar to play a
   marimba scale; drop a ball for a sample. A listening exhibit for the
   boxholder: an HTML page with every sample name and instrument (a pentatonic
   run each) as `<audio>` WAVs rendered headless, so a person can judge by ear
   what the agent cannot.

## Could this be simpler?

- Samples only, no instruments: fails the "instruments" ask and leaves tuned
  feedback (a rising scale as a value grows) to raw tones.
- Instruments only, all synthesized: the boxholder asked for "a sound library
  for things like chimes if possible", and recorded impacts, steps and pages are
  hard to synthesize well.
- Fetch Ogg files and decode in the browser: smaller download, but the
  browser's decoder differs from the headless one, which breaks determinism.
- 16-bit PCM in place of μ-law: twice the size for a quality gain that short
  effects at low gain do not need.

## Review decisions

Cross-model plan review (gpt-6-sol, 2026-11-12), adjudicated:

- Scope too large: accepted in part. Five instruments, not eight; about 30
  sample names, not 45. `variant`, `rate` and `scaleNote` stay: each is a few
  lines and covers a real need (repeated steps, pitch variety, staying in key).
- Skipping a voice while the data loads: accepted. The voice now waits up to
  0.25 s. A fully synchronous library would add the data to every figure's
  load, including figures with no sound.
- esbuild dev builds inline the data: accepted as a cost.
- Rebuild from originals and audition before guidance: accepted.
- Failure only in the console: kept. The figure's sound log is the existing
  channel for "sound starts after the first click"; a missing sample is the
  same kind of message.
- "Tap" versus any gesture: the plan now states the current behaviour; the
  boxholder's words were about autoplay, which stays off.
- Lint ignore for the generated file: accepted; the generator writes
  lint-clean output.
- Citation and `scaleNote` wording: fixed.

Cross-model code review (gpt-6-sol, 2026-11-12), adjudicated:

- Pad silent at C9 (fundamental above the harmonic ceiling): fixed; the
  fundamental always sounds. Test covers C0 and C9.
- Waiting deadline enforced only when the import settles: fixed with a timer.
- `scaleNote` could return C10, which validation rejects: now a clear error;
  TEA.md says to keep the step in range.
- High `epiano` notes aliased: the tine is left out when its sidebands would
  pass Nyquist.
- An error while flushing waiting voices was an unhandled rejection: caught
  per voice and logged; a closed player ignores the late load.
- Tap versus any gesture: unchanged. The gesture rule predates this work; the
  boxholder's words were about autoplay.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent names a sample that does not exist | new | `assertVoice` error lists close names | clear |
| Agent writes a bad note name (`"H4"`, `"C"`) | new | error names the expected form | clear |
| Sample voice before the library chunk loads (browser) | new | waits up to 0.25 s, then dropped with a log line | clear (console) |
| Library chunk fails to load (network) | no | console error, sample voices skipped, others play | clear (console) |
| Generated data drifts from catalog (rebuild forgotten) | new | test: every catalog name has data with the right variant count | clear |
| Many loud samples clip | existing (`mix` clips at ±1) | guidance on gains | silent, documented |
| Same voice sounds different headless and browser | new | both call `renderVoice` with the same library and rate | clear in test |
| Generated file fails lint | n/a | generator writes lint-clean output; `pnpm lint` covers it | clear at commit |

## Agent-flow / user-flow edge cases

- Wrong kind: agent uses `tone` for a chime. ADDRESSED: guidance table puts
  events first and says when to use each kind.
- Fabricated value: agent invents `name: "bee-buzz"`. ADDRESSED: error lists
  names; the docs list is complete.
- Validation error UX: errors follow the existing `sound: voice "<id>" …` form.
- Hand-edit drift, stale refs, concurrent agents, partial migration: do not
  apply; voices are code in one sketch file.

## NOT in scope

- Autoplay without a tap: the boxholder chose to keep the tap.
- Loudness and density reports in the headless transcript: the boxholder said
  such information "won't help that much, except to debug that sounds actually
  play". The transcript already lists every voice.
- Looping or ambient beds, filters and effects on voices, stereo panning: later,
  if figures need them.
- Natural sounds Kenney lacks (water, birds, insects): needs another CC0 source;
  not now.
- Agent-supplied audio files: needs an asset story for figures.

## Open design questions

- Which recorded sound each name gets is chosen by file name, since I cannot
  listen. The exhibit lets the boxholder reject or rename by ear; changes go
  through the catalog and a rebuild.

## Knowledge audits

Add `figure-sound` to `beebox/src/dev/knowledge-audits.yaml`: an agent asked
for a figure with a success chime and a rising scale should know to use
`kind: "sample", name: "chime"` and `kind: "note"` with `scaleNote`. Run it once
against test1.

## What will hold this after it ships

Headless unit tests in `canvas-loop/test/headless/` (the tier the existing
sound tests use): note-name parsing, instrument render length and silence-free
start, sample decode and resample, catalog/data agreement, validation errors,
and a browser fake-DOM test for the lazy load. The docs name list is checked
against the catalog.

## Implementation order

1. Instruments, note names, `scaleNote`, tests.
2. Catalog, originals, build script, generated data, decode, `sample` voice,
   tests, ACKNOWLEDGEMENTS entry for Kenney.
3. Listening exhibit.
4. Browser lazy load and test.
5. TEA.md guidance, CHANGELOG, example, knowledge audit.

## Rollout shape

Lands as one merge with the rest of the canvas-brushes work when the boxholder
asks. No migration: existing voice kinds are unchanged.
