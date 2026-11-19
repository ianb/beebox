---
title: "On-device live text as a Voice settings choice"
status: draft
workstream: browser-live-text-option
issues: []   # the feature issue stays open: a real-mic check and provenance remain
---
# On-device live text as a Voice settings choice

Chrome's on-device speech recognizer already works as the live-text engine, but
only behind a console flag. This plan makes it one more choice in Voice
settings → **While you speak**, per device, and adds a guard for the
recognizer's known silent stall.

**Issues addressed:** `issues/features/2026-09-18-chrome-web-speech-stt-no-key.md`
(the feature) lists four items "remaining before any default or visible
opt-in". This plan does two (the settings choice, the stall guard) and updates
the issue; it stays open for the real-mic check and `liveService` provenance.
Related, not closed here:
`2026-09-18-hq-dictation-default-when-a-key-exists.md` (HQ default, separate),
`exploration/2026-10-08-whistle-in-browser-live-transcription.md` (another
engine), `2026-10-09-ios-quick-chat-on-device-hq.md` (iOS). Searched
`issues/` for `web-speech`, `browser-live-stt`, `on-device speech`.

## Design

### Situations

- When I dictate at my desk in Chrome and my box has no live-text key, I want
  live text anyway, so I can see what I said and say "send message".
- When I don't want a provider to hear my live audio, I want live text that
  stays on this laptop, so the only upload is the recording for the final
  transcript.
- When I pick it on my laptop, my partner's phone on the same box must keep the
  box's service, so my choice does not break their dictation.
- Quiet case: on Safari or a phone the choice does not appear. Someone who never
  opens Voice settings sees no change.

### Right place, right time

Voice settings is already where a person picks how live text works. The option
sits in the **While you speak** list with the box's services. It waits to be
found; nothing announces it. The root panel's summary line reads
"Live: This device" when it is chosen, so the truth shows without opening the
sub-panel.

### Spirit

Serves "see the gears": the option's second line says where the audio goes and
what the first use costs (a download of about 220 MB). Risks "feel possible"
if the download stalls with no feedback; the guard is the sub-line, which reads
"Downloading… this takes a few minutes" and then "Ready".

### Trust

Choosing is a direct action by the person on their own device. The download
starts on that click (the browser requires the click). The sub-line names the
size before the click, so the click is the confirmation.

### Wrong or nothing

- Download fails or is refused: a toast says so; the option stays chosen and
  its sub-line says "Not downloaded yet. Choose it again to download." A
  recording made meanwhile has no live text, and the existing notice says so
  (boxholder decision, 2026-10-30: no fallback to the box's provider).
- The device later loses support (flag left set, browser changed): the option
  still shows with a check and "Not available in this browser", so the person
  can see why live text is missing and pick a box service. This reads "show only
  where available" as governing the offer: hiding a chosen option would leave no
  row checked and no reason shown, against "the checkmark shows the truth".
- The recognizer stalls mid-recording: the guard restarts it; text so far is
  kept.

## Smallest fix and budget

Smallest fix: a fourth `MenuItem` in `VoiceMenuBody` that writes the existing
`bbx:live-engine` key, with the checkmark logic changed so only one row is
checked. The chosen design adds the availability-driven sub-line (folding in
`browser-speech-row.tsx`), a small subscribable store so the root summary and
the checkmarks update together, and the stall guard.

Estimate: source and tests about 250 lines changed; authored docs about 15
(what's-new line, research README status, issue update); generated output 0.

## Stated preferences this plan trades against

- Boxholder, 2026-10-30 (research README): "A device that chose it but has no
  ready pack records with no live text ... It does not fall back to the box's
  provider." Kept.
- Handoff from the boxholder: "it should just be an option in the menu"; "one
  more choice in the existing list, not a separate 'Live text' row or new
  section." This overrides the research README's proposed "Live text" row.
- Memory: minimize invented concepts. The per-device choice stays the existing
  localStorage key; no new server field.

## What already exists

- `beebox/src/frontend/src/lib/audio/live-engine.ts:81` `liveEngine(): "browser" | "service"`
  reads `bbx:live-engine`. Reuse; add a writer and a subscription.
- `live-engine.ts:68` `browserSpeechAvailability(lang)` and `:75`
  `installBrowserSpeech(lang)`. Reuse as-is.
- `components/chat/VoiceChip/browser-speech-row.tsx:18` `BrowserSpeechRow`:
  availability states and the download click. Rebuild as the option's sub-line;
  delete the file (one importer: `panels.tsx:13`, by `grep -rn BrowserSpeechRow src`).
- `components/chat/VoiceChip/panels.tsx:146-151` the While you speak list:
  `{currentService === opt.service ? "✓ " : "  "}{opt.label}`.
- `components/chat/VoiceChip/view.tsx:221-224` `onSelectTranscriptionService`
  returns early when `currentService === service`; must instead also turn the
  device choice off.
- `view.tsx:140` `Live: {transcriptionServiceLabel(currentService)}`.
- `machines/realtime-transcription-live/transcription-browser-speech.ts:209`
  `startBrowserSpeech` reads `liveEngine()` at segment start; unchanged, so a
  choice applies from the next recording.
- `lib/audio/mic-level.ts:25` `getMicLevel()` in [0, 1]; the stall guard's
  speech signal.
- `transcription-browser-speech.ts:64` `BrowserSpeechLink` with a 200 ms tick
  (`STABILITY_TICK_MS`) and a restart path (`spawn`, rapid-restart cap). The
  guard rides on both.

## Prior art (external)

Adopted from `research/browser-live-stt/README.md` (measured 2026-10-30, Chrome
156): `available()`/`install()` semantics, install needs a user gesture and
reports no progress, and the silent failure (1 of 8 long-silence runs: no text,
no error, no `end`). No new external premise; no search.

## Ontology

- **Device live engine** (existing, `live-engine.ts:81`): `"browser" | "service"`,
  per browser profile on this origin, in localStorage. Not a box setting.
- **Box live service** (existing, `transcription.config.service`): box-wide.
  Used only when the device live engine is `"service"`.
- **Browser speech availability** (existing type `BrowserSpeechAvailability`).
- No new nouns.

## Tracks / scope

### Track 1: The menu option

- **What:** "This device (Chrome, on-device)" as the last row of While you
  speak, shown when availability is not `unavailable` or when already chosen.
- **Why:** the engine is only reachable from the console.
- **Direction:** `live-engine.ts` gains `setLiveEngine(engine)` and
  `useLiveEngine()` (`useSyncExternalStore` over a listener set plus the
  `storage` event). `VoiceChip` reads `useLiveEngine()` and passes
  `deviceEngine` down. Box rows check only when `deviceEngine === "service"`.
  Selecting a box row calls `setLiveEngine("service")`; if that write fails,
  toast and stop. Then it mutates only if the service differs. Picking a
  different box service changes the box default for every device, as the row
  does today; a rejected mutation (a non-owner, a server error) keeps the
  existing toast, and the checkmark returns to the still-configured service,
  which this device now uses. A new `DeviceSpeechOption` component (in
  `browser-speech-row.tsx`, renamed `device-speech-option.tsx`) owns the
  availability query and the click: `setLiveEngine("browser")`, and when
  availability is `downloadable` it calls `installBrowserSpeech` in the same
  click. The install promise lives in `live-engine.ts` (module level), so a
  menu closed and reopened mid-download finds it, awaits it, and re-reads
  availability instead of sticking at "Downloading…". The root summary shows
  "This device" when chosen.
- **Vocabulary lock-ins:** label "This device (Chrome, on-device)"; menu id
  `bbx-voice-live-device`.
- **Depends on:** `install()` needs a gesture (research README line 34,
  measured); `startBrowserSpeech` reads the flag per segment
  (`transcription-browser-speech.ts:209`, read).
- **First chunk:** store + option + checkmark logic + summary, with a pure
  `deviceOptionNote(availability, chosen)` and a test for it.

### Track 2: Stall guard

- **What:** restart the recognizer when the mic hears speech but no result
  arrives.
- **Why:** research measured a silent stop; without a guard, live text and
  spoken keywords die mid-recording with no sign.
- **Direction:** `BrowserSpeechLink` takes `hearing: () => boolean`. On each
  tick, while `hearing()` is true, add the tick to `heardMs`; any result resets
  `heardMs` to 0, as does a new recognizer. When `heardMs` reaches
  `STALL_HEARD_MS` (4000), log a warning, drop the current recognizer's
  handlers, abort it, fold its text, and restart through the same guarded path
  `onEnd` uses (a throwing restart gives up via `onServerError`). The rapid-
  restart cap does not count 4 s restarts, so the guard has its own budget of
  `MAX_STALL_RESTARTS` (3) per segment; past it, the guard logs once and stops
  restarting, leaving the recognizer running. Loud non-speech (music) thus costs
  at most three restarts, with text kept. The actor's `abandonLive` also sets
  `browserSpeech = null`, so mic recovery does not report a detached link as
  restored (`transcription-actor.ts:324`). The actor passes `() => !this.held && getMicLevel() >= SPEECH_LEVEL`.
  `held` excludes the box's own speech, which the recognizer receives as
  silence (`mic-capture/core.ts:169`).
- **Depends on:** `getMicLevel` returns the live capture's level
  (`mic-capture/core.ts:151` registers it); `spawn` caps rapid restarts
  (`transcription-browser-speech.ts:86`). `SPEECH_LEVEL` is calibrated in
  the Chrome verification with the fake-audio WAV (silence vs speech).
- **First chunk:** guard + fake-recognizer tests (stall restarts and keeps text;
  results keep it from firing; held never fires).

## Could this be simpler?

The smallest fix (a bare fourth row) fails two cases: a device with no pack
gets a checked option and no live text with no way to start the download
(`install()` needs a click in the menu), and the root summary would still say
the box service while this device uses the browser, breaking "the checkmark
shows the truth". The stall guard is about 25 lines on an existing tick; the
alternative (file it) leaves a known silent failure in a user-facing option.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| localStorage throws (privacy mode) on write | no | warn, choice not saved, toast | clear |
| localStorage readable at choice, unreadable at a later segment start | no | reads as `"service"` (existing) | silent; accepted: needs storage to fail between a successful write and a read in one origin |
| `install()` resolves false or rejects | no | toast, sub-line returns to not-downloaded | clear |
| availability query rejects on menu open | no | toast (existing) | clear |
| Recognizer stalls with speech present | add | guard restarts | clear in console |
| Guard misfires on loud non-speech (music) | add (sustained loud, zero results) | restart keeps text; per-segment budget of 3 | console only; harmless |
| Guard's restart throws | add | gives up via `onServerError`, live text off, notice | clear |
| Menu reopened mid-download | no | module-level install promise | clear |
| Another tab changes the choice | no | `storage` event updates checkmark | clear |

## Agent-flow / user-flow edge cases

Walk, way in: open voice chip (`view.tsx:236`) → Voice settings → panel renders
`VoiceMenuBody` (`panels.tsx:144`) → `DeviceSpeechOption` queries
availability → person clicks → `setLiveEngine("browser")`, install starts →
sub-line "Downloading…" → next recording: `startBrowserSpeech` sees the flag
(`transcription-browser-speech.ts:209`) and availability `available` → link
starts, `WS_CONNECTED`.

Way out: person clicks Voxtral → `setLiveEngine("service")`; mutation skipped
if Voxtral is already the box service → next recording `"not-opted-in"` →
`beginLinking()` (`transcription-actor.ts:353`). A recording already running
keeps its engine until it ends.

- Wrong field: ADDRESSED, box rows never check while the device option is on.
- Stale ref / two agents / hand-edit drift / fabricated value: no agent or
  card surface; not applicable because the state is one localStorage key
  written only by this menu or the console.
- Validation error UX: unknown values read as `"service"` (`live-engine.ts:83`).
- Transition: existing devices with the flag set show the option checked.
- Stored state that never clears: the key clears only when the person picks a
  box service on this device. Clearing site data also clears it; correct.

## NOT in scope

- Provenance of the live engine on the message (`Emission.liveService`, research
  README): separate; no reader for it yet.
- Download progress: `install()` reports none.
- Using the browser engine as a no-key automatic fallback: the boxholder chose
  an explicit choice.
- Non-owner restrictions: the device choice touches no box setting, so any
  viewer may pick it.

## Open design questions

None.

## Knowledge audits

None: no agent-facing concept. The box agent learns of it from the what's-new
line.

## What will hold this after it ships

Unit tests at the pure-function tier: `deviceOptionNote` and the link's stall
guard with the existing fake recognizer. The menu is verified once in real
Chrome; no new test tier.

## Implementation order

1. Track 2 guard + tests.
2. Track 1 store, option, summary, tests.
3. Chrome verification in a fresh profile (fake-audio WAV): choose the row,
   record before the pack is ready (notice, recording continues, no provider
   socket), then after download (live text), then switch back. Exhibit,
   what's-new line, research README status, issue update.

## Rollout shape

Done when the new tests and the existing
`transcription-browser-speech.test.ts` pass, typecheck and lint pass, and the
option is seen in real Chrome on the worktree box: chosen, downloaded, live
text appears, and choosing a box service turns it off. No migration: the
existing key keeps its meaning.
