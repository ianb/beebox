# Live transcription in the browser, 2026-10-30

Can dictation's live text run in the browser, on the device, with no provider
key? Tested against Chrome 156, Safari 27.2 and three in-page models on an
Apple Silicon Mac. HQ was left out of scope: it stays on the server.

Issue: [Web Speech live transcription](../../issues/features/2026-09-18-chrome-web-speech-stt-no-key.md).
Scripts: [harness/](harness/). Flagged prototype:
`beebox/src/frontend/src/machines/realtime-transcription-live/transcription-browser-speech.ts`.

## Recommendation

| Option | Disposition |
|---|---|
| Chrome desktop `SpeechRecognition` with `processLocally` | **Adopt**, per-device opt-in, live text only |
| Safari `webkitSpeechRecognition` | **Reject** for this feature: it has no way to require on-device |
| Whistle in the page | **Later**: the route to Safari, Firefox and Android, if they matter |
| Moonshine in the page | **Reject**: a larger download than Whistle for a small accuracy gain |
| Android Chrome, iOS Safari | **Reject**: no on-device mode; the iOS app has its own path |

Whistle changes one earlier decision. The 2026-10-06 rejection of an in-page
model rested on "a few hundred MB"; Whistle is 18 MB under Apache-2.0.

## What was measured

Audio was synthetic (`say`) or public (LibriSpeech dummy set), fed through a
`MediaStreamTrack`. No person's voice on a real microphone was tested on
purpose, so accuracy on real dictation is still open: see "Not established".

### Chrome on-device recognizer

| Question | Result |
|---|---|
| Availability | `available()` says `downloadable`; `install()` needs a user gesture |
| Download | 194 MB language pack + 25 MB engine, 107 s, per Chrome profile; en-GB is covered by the en-US pack |
| No pack, `processLocally: true` | Fails at once with `language-not-supported`; no silent cloud fallback |
| Audio stays local | 140 s of speech uploaded no audio-sized traffic (38 KB sent by all of Chrome, nearly all at startup); works with DNS blocked |
| Control for the DNS block | With no pack and `processLocally: false`, the same block gives `network` errors, so the block is real |
| `processLocally: false` with a pack, DNS blocked | Still transcribes. Chrome used the pack, so the flag must be set; the pack's presence alone says nothing about which path ran |
| Session limit | None in 25 min of continuous speech: one recognizer, no restart, longest text gap 2.4 s |
| Silence | Survived 150, 240, 300, 360 s of digital silence and 300, 360, 400 s of low noise; 90 s before first speech is fine |
| Silent failure | 1 of 8 runs with 5+ minutes of silence: no later text, no error, no `end`. Not reproduced in 3 repeats of that case |
| Latency | Last word of an utterance shows before the end of its audio (p50 −309 ms, p90 −114 ms, utterance audio has trailing silence); final result p50 +364 ms, p90 +704 ms |
| Revisions | Interim revisions reach back 1 word at p50, 3 at p99, 5 at most |
| Finals | Arrive after about a second of real silence. Continuous speech stays one growing interim |
| `stop()` | Delivers no final: the last interim is the transcript, so the adapter keeps it |
| Formatting | Little punctuation or capitalization; "8 30", and "four thousand dollars" came out as "4,000" |
| `quality` hint | `command`: available. `dictation` and `conversation`: unavailable, though the pack dictated well here |
| CPU | About 17% of one core during speech, 6% in silence, whole Chrome tree |

Latency ran alongside six other recognizers, so these are upper bounds.

### Browser support

| Browser | Result | Source |
|---|---|---|
| Chrome 156 desktop | Works as above | Measured |
| Safari 27.2 macOS | `webkitSpeechRecognition` only: no `processLocally`, `available`, `install` | Measured; recognition itself not run |
| Android Chrome, ChromeOS | No on-device Web Speech | [Chrome engineer on blink-dev](https://go.mail-archive.com/blink-dev@chromium.org/msg16507.html) |
| Edge | Behind flags in Canary and Dev | [Microsoft docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api) |
| Firefox | Not usable by default | Not measured |
| iOS Safari | Out of scope (2026-10-06 decision) | |

### One mic, two consumers

Works. The app's PCM worklet and the recognizer ran on one capture and the
worklet received a full 45.6 s of audio in both wirings. `start(track)` accepts
a `MediaStreamAudioDestinationNode` track, which gives the shape the prototype
uses: mic → gain → destination → recognizer. Muting the gain holds the mic during
speech playback, and swapping the mic source upstream did not disturb the
recognizer (one instance throughout).

Warning: `start()` with no track ignores Chrome's fake-device flags and opens
the real microphone, even headless. Automated runs must always pass a track.

### Compared with models in the page

| Engine | Download | WER, 9 min LibriSpeech | WER, 41 s TTS | Live speed |
|---|---|---|---|---|
| Chrome on-device | 219 MB, shared per profile | 8.4% | 4.9%, 4.2% | Words as spoken |
| Whistle, live API | 18 MB | 10.3% | 5.6%, 4.2% | 530–610 ms per 1 s pass (p90 930), one thread, so a word commits about 2 s late |
| Moonshine tiny, WebGPU | about 74 MB | 11.2% | not run | 175 ms per utterance, after the utterance ends |
| Moonshine base, WebGPU | about 152 MB | 7.7% | not run | 200 ms per utterance, after the utterance ends |

Scoring is plain word error with no normalizer, so "mister"/"Mr." counts against
every engine. Read these as a ranking, not as published-style figures. Whistle
adds punctuation, which Chrome mostly does not. It runs flat out at about 55–60%
of a core in real time on this machine and would need a Worker; a slower laptop
may not keep up. Battery was not measured for any engine.

## How it joins the pipeline

The actor keeps its order: staged recording first, then the mic, then live text.
A socket and the recognizer are alternatives for the last step, so the recording,
HQ, and every event the machine sees stay as they are. The `transcription.json`
service enum is not involved, and the choice belongs to the device, since the
language pack does too.

Keywords needed one adaptation. `useKeywordSpotting` matches finals anywhere and
interims only at the start, and this engine can go minutes without a final, so
"send message" after a sentence would not fire. The adapter counts a word as final
once it has held still for 700 ms. This follows the precedent in the OpenAI
realtime path, which treats stable deltas as final.

The end-to-end run (real app, fake mic, synthetic speech) showed live text in the
composer, a spoken "send message" firing the send, the mic re-arming, no streaming
socket opened, and the recording staged to the box. The test box has no key, so
the message read "Live text — HQ transcript unavailable". A successful HQ pass
after browser live text was not exercised, to avoid paid calls.

Provenance is a gap. A message records `hqService` but nothing about its live
engine, for any service. `Emission` would gain a `liveService` next to `hqService`
(`beebox/src/frontend/src/input/emission.ts`, and the quick-chat record in
`beebox/src/core/chat/routing/quick-chat-record.ts`).

"Local" here covers live recognition only. The recording still uploads to the
box for HQ, and the box sends it to its HQ provider when one is configured.

## Proposed product

- A "Live text" row in the voice chip's panel: **Box service** or **This device**,
  with **This device** offered only when `available()` is not `unavailable`.
- Choosing it starts the 220 MB download on that click (the gesture `install()`
  needs), with progress, because `install()` reports none and takes minutes.
- The setting is per device. A device that chose it but has no ready pack records
  with no live text, so spoken keywords do not work; the prototype does this
  instead of quietly sending live audio to the box's provider.
- A box with no key gets working live text on Chrome desktop. HQ still needs a key,
  and without one the message keeps its live text, as the end-to-end run showed.
- Copy says "on this device"; Safari is never offered this, so the claim holds.

## Not established

- **Real voice on a real microphone.** All accuracy here is TTS or read audiobooks.
- **A comparison with Voxtral and Deepgram** on the same audio (paid calls).
- **The silent failure's cause.** It needs a guard before default use: restart the
  recognizer when the mic level shows speech but no result arrives. The existing
  5-minute idle close already ends a mic with no new words, which limits exposure.
- **Restart and stitching in the wild.** Chrome never ended a session on its own
  here, so the transparent restart has only run against a fake in tests.
- **Older reports of session limits** do not reproduce with `start(track)` on
  Chrome 156; the no-track path was not tested, on purpose.
- **Non-Apple-Silicon laptops, and the `phrases` member** for biasing toward
  keywords, which exists in Chrome 156 and was not tried.

Whistle sources: [blog](https://cactuscompute.com/blog/whistle),
[weights](https://huggingface.co/Cactus-Compute/whistle),
[engine](https://huggingface.co/Cactus-Compute/needle3).
Quality hint: [Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/P8P-x7AnC6I).

## Running it

From `harness/`: start `server.ts` (port 8931), then `install.ts` once for a
profile, then `run.ts`, `two.ts`, `models.ts`, `quality.ts` or `e2e.ts`. Each file
header gives its arguments. `WHISTLE_DIR` points at the downloaded `needle.js`,
`needle.wasm` and `whistle.cact`. Prototype flag:
`localStorage["bbx:live-engine"] = "browser"`.
