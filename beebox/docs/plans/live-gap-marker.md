---
title: "Mark gaps in the live transcript"
status: active
workstream: hq-always
issues: []
---
# Mark gaps in the live transcript

When live transcription goes offline mid-recording, the recording continues
and the HQ pass later fills in what was said. Until then the composer and the
pending message show only the live text from before the drop, so a send looks
nearly empty. This plan puts `[…]` into the live transcript where live text is
missing, and sends it to the agent as `<unsure>[…]</unsure>` when the live
text is what gets sent.

**Issues addressed:** none filed. Searched `issues/` for "live text paused",
"gap", "offline", "recordingLocal": nothing open covers this. Related history:
`issues/bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md`
(the recording outliving the socket, which this builds on).

## Design

### Situations

- When Priya is dictating a long note on a train and the connection drops for
  a minute, I want the text on screen to show that something is missing, so I
  can trust that the rest was heard and keep talking instead of starting over.
- When Priya taps Send while live text is still down, I want the pending
  message to show that more was said than appears, so the nearly empty bubble
  does not look like the box lost my words.
- When the HQ pass also fails and the live text is sent, I want the agent to
  know there is a hole, so it asks or retranscribes instead of answering half
  a sentence as if it were whole.
- When the connection blinks for a second and the replay recovers the words,
  I do not want a lasting marker: nothing is missing.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Live text down mid-recording | show | composer live transcript, after the last live words | waits to be found (the overlay chip already says "live text paused") |
| Send while still down | show | pending HQ bubble text | waits to be found |
| HQ fails, live text sent | show | sent message body; agent sees `<unsure>[…]</unsure>` | background |
| Short blink, replay covered it | quiet | marker removed on reconnect | — |

The marker appears at the drop, not later: the overlay chip already reports
the state, and the marker places it in the text. A blink of a second or two
shows the marker briefly; that is accurate, and suppressing it would need a
timer the transcript does not otherwise have.

### Spirit

- **Serves:** "You should be able to see the gears" — the transcript shows
  where the live pass lost track instead of looking complete.
- **Serves:** "Messy is fine" — the box is "honest about uncertainty"
  (`docs/architecture/spirit.md:79`) by sending a known hole as unsure.
- **Risks:** "It should feel like a place" — noise in the text. Guard: the
  marker is three characters and disappears whenever HQ succeeds.

### Trust

Shows only, takes no action. The marker must also not create one: spoken
commands never match across it (Track 1). The agent's response to an unsure
span is already governed by the chat prompt's unsure-mark guidance.

### When it goes wrong or does nothing

- Replay covered the gap: no marker.
- Live text never came back before send: the marker is the last thing in the
  live text; the HQ pass replaces it all if it succeeds.
- The recording ends without a send (silence auto-stop, mic loss past its
  window): the transcript, marker included, folds into the composer as
  editable text. The person sees the gap and can type over it.
- The microphone itself is lost (`reconnecting`): no audio exists for that
  stretch, and this plan does not mark it (NOT in scope).
- Unconfirmed in-progress words at the moment of the drop vanish, as they do
  today (`fold()` keeps only final text,
  `transcription-segment-text.ts:26`). They fall inside the gap, so the marker
  stands for them too.
- Recording before the first live connection: no marker; the pending bubble
  already says "Recording without live text"
  (`voice-keyword-send.ts:124`) when nothing was transcribed.

### Walkthrough

Priya dictates "Pick up the dry cleaning and then" — live text shows it. The
socket drops (`dropLink`). The actor folds the text and sends a TEXT_UPDATE:
the composer shows "Pick up the dry cleaning and then […]", the chip says
"Recording · live text paused". She keeps talking for 45 s. The socket comes
back; the replay ring holds only ~30 s, so the marker stays and new live text
appends after it. She taps Send. The pending bubble shows the live text with
the marker while HQ runs. HQ succeeds: the sent message is the full HQ text,
no marker. Had HQ failed, the sent message would read
`<speech stt="live" …>Pick up the dry cleaning and then <unsure>[…]</unsure> …</speech>`
and the chat would render the marker with the unsure underline.

## Smallest fix and budget

Smallest fix: append `[…]` to the live text on every drop and never remove
it. Chosen design: also remove it on reconnect when the replay covered the
gap and the recognizer has caught up, block keyword matches across it, and
wrap it as unsure at assembly. One track, frontend only. Estimate: ~120
source lines (gap state, ring, segment text, actor, tokenizer, assembler,
prompt), ~150 test lines, one knowledge audit. Docs: one paragraph in
`docs/chat/composer.md`.

## Stated preferences this plan trades against

- Boxholder (2026-10-10): keep the marker in the sent message; "ideally it
  would get that confidence tag too".
- `feedback_minimal_concepts_prefer_primitives` (memory): reuse `<unsure>`
  rather than a new tag or attribute. The cost is that `<unsure>` gains a
  second meaning, "audio the live pass never transcribed"; the prompt gets
  one sentence for it.

## What already exists

- `ReplayRing` (`machines/realtime-transcription-live/transcription-replay-ring.ts:28`):
  *"markGap(opts: { padFrames: number })"* and `sinceGap()`; *"A
  (re)connected socket is sent the frames since that point, capped at the
  ring"*. Reuse: it is the one place that knows whether a gap was covered.
- `REPLAY_CAP_CHUNKS = 100` (`transcription-actor.ts:82`): *"the last 100
  worklet frames (~300 ms each, ≈30 s)"*.
- `TranscriptionSession.dropLink` (`transcription-actor.ts:250`) folds text and
  marks the gap; `abandonLive` (`:261`) folds text and ends live for the
  segment; `adopt` (`:315`) replays `sinceGap()`. Reuse all three as the hook
  points.
- `SegmentTranscript` (`transcription-segment-text.ts:12`): committed prefix
  plus current connection text; `fold()` moves current into committed. Extend
  with the marker.
- `stop()` (`transcription-actor.ts:374`) sends TRANSCRIPTION_DONE without
  text; `setFinalTranscript` (`realtimeTranscriptionMachine.ts:143`) then
  *"keeps"* `context.finalTranscript`. So a marker delivered by TEXT_UPDATE
  survives to the send.
- `tokenizeInput` (`lib/patmatch/tokenize.ts:69`): a punctuation-only token
  joins the previous word's `trailing`, so keyword spotting ignores `[…]`.
- `markUnsureWords` (`input/unsure-words/mark.ts`) runs in
  `assembleChatMessage` only when `emission.words !== undefined`
  (`input/targets/chat-assemble.ts:116`). The marker needs wrapping for every
  live voice emission, Deepgram or not, so it is a separate step after it.
- `UserMessageText` renders `<unsure>` with the dotted underline
  (`components/chat/user-message-text.tsx`). Reuse.

## Prior art (external)

No decision depends on an external premise. Transcript gap notation such as
`[inaudible]` is a common convention; `[…]` was the boxholder's suggestion.

## Ontology

- **Live gap marker** — the literal string `[…]` (U+2026) in a segment's live
  transcript. New. Not a composer token (`[file#N]`, `[image#N]`).
- **Gap** — existing (`ReplayRing.gapStart`): frames since live forwarding
  stopped.
- **Outage start** — new: the frame count when live forwarding actually
  stopped, before the replay pad is subtracted. `gapStart` is
  `outageStart - padFrames`.
- **Covered gap** — new term: every frame since the outage start is still in
  the ring at reconnect (`seen - outageStart <= frames.length`). Covered
  means the audio is available for replay, not that it has been transcribed.
- **Gap state** — new: `GapState` in `SegmentTranscript`
  (`beforeFirst | none | open | awaitingText`). It lives with the text it
  edits rather than in a separate class.

## Tracks / scope

### 1. Marker in the live transcript, unsure at assembly

- **What:** the actor inserts and removes the marker; the assembler wraps it.
- **Why:** a send during or after an uncovered drop shows less text than was
  spoken, with nothing saying so.
- **Direction:**
  - `ReplayRing.markGap` records `outageStart` as well as the padded
    `gapStart`; add `coversGap(): boolean` per the Ontology.
  - `SegmentTranscript.openGap()`: fold, then append `LIVE_GAP_MARKER` to the
    committed prefix, once (no `[…] […]`). `dropGapMarker()`: remove that
    trailing marker.
  - Gap decisions live in `SegmentTranscript` as `GapState`: on drop or
    abandon, open the gap and send a TEXT_UPDATE (merged text, empty
    interim). On reconnect: if not covered, the marker is permanent; if
    covered, it stays until the new connection delivers its first non-empty
    final text, then it is removed. A send in between keeps it.
  - First connect: the gap starts at frame 0 (`transcription-replay-ring.ts:8`).
    No marker before it; if that connect's replay is not covered, the marker
    goes at the start.
  - Keyword spotting: `tokenizeInput` (`lib/patmatch/tokenize.ts:69`) emits
    the marker as its own word whose normalized form matches no pattern word,
    so no phrase can span it.
  - `assembleChatMessage`: after unsure marking, for a voice emission without
    `hqText`, wrap each bare `LIVE_GAP_MARKER` not already inside
    `<unsure>…</unsure>`, anywhere in the text. Markers folded into the
    composer from an earlier segment, or restored by "Continue" on recovered
    dictation, are voice-made too. A person typing `[…]` into a voice message
    gets it wrapped; accepted.
  - Prompt: one sentence in the unsure paragraph of
    `core/chat/session/prompts.ts`.
- **Vocabulary lock-ins:** `LIVE_GAP_MARKER = "[…]"`, exported from one module
  shared by actor and assembler.
- **First implementation chunk:** `ReplayRing.coversGap` and the
  `SegmentTranscript` gap state with an event-sequence doctest; then the actor wiring; then tokenizer, assembler, and prompt.

## Could this be simpler?

The simplest version appends the marker on every drop and never removes it.
It fails the "short blink" situation: most drops on a flaky uplink reconnect
in a second or two (`realtimeTranscriptionMachine.ts`, `LIVE_TEXT_CUE_DELAY`
comment) and the replay recovers them, so the text would collect false holes.
Removing the marker when `coversGap()` is true costs one comparison.
Wrapping in `<unsure>` reuses an existing tag instead of adding one.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Two drops before reconnect leave `[…] […]` | planned (segment-text doctest) | `openGap` skips a trailing marker | clear |
| Replay covered, marker not removed | planned | `closeGap({covered:true})` | visible as a false hole |
| Marker inside an unsure span gets double-wrapped | planned (assemble doctest) | wrap only outside spans | clear |
| Send between a covered reconnect and the first new text sends without marker | planned (gap-state doctest) | marker kept until first non-empty final | clear |
| First new final covers only the replay pad (words already shown), so the marker goes before the gap's own words arrive | no | none | accepted: the rest of the replay transcribes within a second or two, and the recognizers expose no audio timestamps on every service to do better |
| Replay pad counted as outage, false permanent hole | planned (ring doctest) | `outageStart` separate from `gapStart` | clear |
| Keyword spotted across a gap ("cancel […] message") | planned (tokenize doctest) | marker is its own unmatched word | clear |
| Marker folded into composer, sent later unwrapped | planned (assemble doctest) | wrap anywhere in voice text | clear |
| Marker next to unsure-marked words misaligns marking | planned (assemble doctest with words on both sides) | marker is a body token no word matches | clear |
| HQ text replaces live text | existing (voice-intent doctest) | HQ branch builds fresh text | marker gone, correct |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag — ADDRESSED: one tag, `<unsure>`; the prompt sentence says what
  the bracketed form means.
- Stale ref — not applicable.
- Two agents — not applicable.
- Hand-edit drift — ADDRESSED: a typed-only message never wraps; a `[…]`
  typed into a voice message's prefix gets wrapped (accepted).
- Fabricated value — ADDRESSED: the agent never writes the marker; the unsure
  guidance already says never emit `<unsure>`.
- Validation UX — not applicable.
- Transition state — ADDRESSED: older messages simply have no marker.

## NOT in scope

- Marking microphone loss (`reconnecting`): no audio exists, a different
  meaning; considered, not now because the user asked about live text.
- iOS: Apple's live recognizer runs on the device and does not drop this way.
- A configurable or localized marker string.

## Open design questions

None. The boxholder chose the marker, keeping it in the sent message, and the
unsure wrap.

## Knowledge audits

One new `knows_directly` entry: a live message containing
`<unsure>[…]</unsure>`; the agent should read it as speech that was not
transcribed and ask or retranscribe if it matters. Run before landing.

## What will hold this after it ships

Doctests (`test/machines/realtime-transcription-live/transcription-segment-text.live-gap.doctest.md`):
the `SegmentTranscript` gap state as event sequences (drop, covered reconnect,
send before first text, first text, uncovered reconnect, double drop,
abandon), `ReplayRing.coversGap` with the pad, `tokenizeInput` with a marker,
and `chat.emission-assemble` wrapping with unsure words on both sides. There
is no actor-level doctest (the actor needs a microphone worklet and staging
queue; the machine doctests use a fake actor), so the actor stays thin
wiring over the tested class, and a browser check with DevTools "Offline"
covers it.

## Implementation order

1. `ReplayRing.coversGap`, `SegmentTranscript` gap state, doctests.
2. Actor wiring in `dropLink`, `abandonLive`, `adopt`, `onTextUpdate`.
3. Tokenizer word, assembler wrap, prompt sentence, composer doc paragraph.
4. Knowledge audit, cross-model diff review.

## Rollout shape

Done when the segment-text, replay-ring, and emission-assemble doctests pass,
`pnpm test:changed` is green, the new audit passes, and a browser check with
DevTools "Offline" during dictation shows the marker. No data migration.
