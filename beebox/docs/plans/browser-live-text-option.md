---
title: "On-device live text as a Voice settings choice"
status: draft
workstream: browser-live-text-option
issues: []   # the feature issue stays open: real-mic check, provenance, stall guard remain
---
# On-device live text as a Voice settings choice

Chrome's on-device speech recognizer already works as the live-text engine, but
only behind a console flag. This plan makes it one more choice in Voice
settings → **While you speak**, per device.

**Issues addressed:** `issues/features/2026-09-18-chrome-web-speech-stt-no-key.md`
lists four items "remaining before any default or visible opt-in". This plan
does the settings choice and updates the issue. The issue stays open for the
real-mic check and `liveService` provenance. The stall guard is now
`issues/bugs/2026-11-19-on-device-live-text-silent-stall.md`. Related, not
closed: `2026-09-18-hq-dictation-default-when-a-key-exists.md`,
`exploration/2026-10-08-whistle-in-browser-live-transcription.md`,
`2026-10-09-ios-quick-chat-on-device-hq.md`. Searched `issues/` for
`web-speech`, `browser-live-stt`, `on-device speech`, `silent`.

## Design

### Situations

- When I dictate at my desk in Chrome and my box has no live-text key, I want
  live text anyway, so I can see what I said and say "send message".
- When I don't want a provider to hear my live audio, I want live text made on
  this laptop; the recording still uploads for the final transcript.
- When I pick it on my laptop, my partner's phone on the same box keeps the
  box's service.
- Quiet case: on Safari or a phone the choice does not appear.

### Right place, right time

Voice settings is where a person picks how live text works. The option is the
last row of **While you speak**. It waits to be found. The root panel's summary
reads "Live: This device" when it is chosen.

### Spirit

"See the gears": the row's second line says where live text is made and what
first use costs (about 220 MB).

### Trust

Choosing is a direct action on the person's own device. The download starts on
that click (the browser requires a click). The size shows before the click.

### Wrong or nothing

- Download fails: a toast; the row stays chosen and reads "Not downloaded yet.
  Choose it again to download." A recording meanwhile has no live text and the
  existing notice says so (boxholder decision, 2026-10-30: no fallback to the
  box's provider).
- The browser loses support while chosen: the row stays, checked, with "Not
  available in this browser", so the person sees why and can pick a box
  service. Hiding it would leave no row checked and no reason.

## Smallest fix and budget

One more row, the existing `bbx:live-engine` key with a writer and a
subscription so the checkmarks and summary update, and the old download row
folded into the new row's sub-line. About 210 lines changed (source); docs
about 15; generated 0.

The boxholder asked mid-implementation why this was not "a small pref
addition". A drafted stall guard and mid-download reopen handling were cut;
the guard is filed as an issue.

## Stated preferences this plan trades against

- Boxholder: "it should just be an option in the menu"; one more choice in the
  existing list (handoff paraphrase). Overrides the research README's proposed
  separate "Live text" row.
- Boxholder, 2026-10-30: no fallback to the box's provider without a pack. Kept.
- Boxholder, 2026-11-19: "Seems like it should be a small pref addition." Scope
  cut to the pref.

## What already exists

- `beebox/src/frontend/src/lib/audio/live-engine.ts:81` `liveEngine()` reads
  `bbx:live-engine`. Reused; add `setLiveEngine` and `useLiveEngine`.
- `live-engine.ts:68` `browserSpeechAvailability`, `:75` `installBrowserSpeech`.
  Reused as-is.
- `components/chat/VoiceChip/browser-speech-row.tsx` `BrowserSpeechRow`, one
  importer (`panels.tsx:13`). Renamed to `device-speech-option.tsx` and
  rebuilt as the option row.
- `panels.tsx:146-151` the While you speak rows; `view.tsx:221-224`
  `onSelectTranscriptionService`; `view.tsx:140` the "Live:" summary.
- `transcription-browser-speech.ts:209` `startBrowserSpeech` reads
  `liveEngine()` at segment start. Unchanged: a choice applies from the next
  recording.

## Prior art (external)

Adopted from `research/browser-live-stt/README.md` (Chrome 156, 2026-10-30):
`available()`/`install()` semantics; install needs a user gesture and reports
no progress. No new external premise.

## Ontology

- **Device live engine** (existing `LiveEngine`, `"browser" | "service"`), per
  browser profile, in localStorage. Not a box setting.
- **Box live service** (existing `transcription.config.service`), box-wide; used
  only when the device live engine is `"service"`.
- No new nouns.

## Tracks / scope

### Track 1: The menu option

- **What:** "This device (Chrome, on-device)" as the last While you speak row,
  shown when availability is not `unavailable`, or when already chosen.
- **Why:** the engine is reachable only from the console.
- **Direction:** box rows check only when the device engine is `"service"`.
  Picking a box row first calls `setLiveEngine("service")` (toast and stop if
  storage refuses), then mutates only if the service differs. Picking a
  different box service changes the box default for every device, as the row
  already does; a rejected mutation keeps the existing toast, and the checkmark
  shows the still-configured service this device now uses. Picking the device
  row calls `setLiveEngine("browser")` and, when availability is
  `downloadable`, starts `installBrowserSpeech` in that click. A menu reopened
  mid-download re-reads availability.
- **Vocabulary lock-ins:** label "This device (Chrome, on-device)"; summary
  "This device"; id `bbx-voice-live-device`.
- **Depends on:** install needs a gesture (research README, Findings table,
  measured); `startBrowserSpeech` reads the flag per segment
  (`transcription-browser-speech.ts:209`).
- **First chunk:** all of the above; one commit.

## Could this be simpler?

This is the simple version. A bare row with no sub-line fails a device with no
pack: it would be checked with no live text and no way to start the download,
which needs a click in the menu.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| localStorage refuses a write | no | warn + toast, choice unchanged | clear |
| `install()` resolves false or rejects | no | toast, sub-line back to not-downloaded | clear |
| availability query rejects | no | toast | clear |
| Another tab changes the choice | no | `storage` event updates the checkmarks | clear |
| Recognizer stalls mid-recording | no | none; filed as an issue | silent; accepted for now |

## Agent-flow / user-flow edge cases

Way in: voice chip → Voice settings → `VoiceMenuBody` → `DeviceSpeechOption`
queries availability → click → `setLiveEngine("browser")`, install starts →
next recording: `startBrowserSpeech` sees the flag and starts the recognizer.

Way out: click a box service → `setLiveEngine("service")` → mutation only if
the service differs → next recording `"not-opted-in"` → `beginLinking()`. A
recording already running keeps its engine until it ends.

- Wrong field: ADDRESSED; box rows never check while the device row is on.
- Stale ref, two agents, hand-edit drift, fabricated value: no agent or card
  surface; the state is one localStorage key.
- Transition: devices with the flag already set show the row checked.
- Stored state: the key clears when the person picks a box service on this
  device, or clears site data.

## NOT in scope

- Stall guard: filed, `issues/bugs/2026-11-19-on-device-live-text-silent-stall.md`.
- `liveService` provenance on the message: no reader yet.
- Download progress: `install()` reports none.
- Automatic no-key fallback: the boxholder chose an explicit choice.

## Open design questions

None.

## Knowledge audits

None: no agent-facing concept. The what's-new line tells the box agent.

## What will hold this after it ships

The row is UI wiring with no logic worth a unit test; it is verified once in
real Chrome. The engine's behavior keeps its existing tests.

## Implementation order

1. Store, row, summary.
2. Chrome verification in a fresh profile with a fake-audio WAV: choose the
   row, download, record (live text, no provider socket), switch back. Exhibit,
   what's-new line, issue update.

## Rollout shape

Done when typecheck and lint pass and the Chrome walk above is seen. No
migration: the existing key keeps its meaning.
