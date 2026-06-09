# Composer input machine — design note

**Status:** implemented, as the overlay decomposition described in the note below
(`src/frontend/src/machines/composerMachine.ts`, wired in `InteractiveChat-voice.ts`, doctested
in `test/composer-machine.doctest.md`). Audience: us. The companion doc `composer-states.md`
enumerates the rendered states with screenshots; this doc records the design of the machine
behind them, and keeps the five-state child-invoke version as the target end-state.

> **Implementation note (overlay decomposition).** The body below works up to a five-state voice
> region (`idle | dictating | committing | speaking | pausedForSpeech`). That is the *idealized*
> model — but `dictating`/`committing` duplicate `realtimeTranscriptionMachine`, and owning them
> in a sibling React hook needs a race-prone mirror (a mid-tick keyword restart can fire a stale
> "mic went idle" and kill the just-restarted mic). Owning them *cleanly* requires the composer
> machine to **invoke** the transcription machine as a child actor — a larger rewrite of the
> transcription stack, deferred.
>
> The **shipped machine** (`composerMachine.ts`) is therefore the *overlay* only: the three
> speech-coordination states `idle | speaking | pausedForSpeech` that no existing machine owns,
> plus the `hq` and `keyboard` regions. "Recording" stays in the transcription machine and is
> mirrored in as the `recording` context flag; the mic-button "recording" look still reads
> `transcription.state`. This kills `voicePaused`/`voicePausedRef` and makes the
> suppress/pause/resume coordination declarative, with no React mirror and no races. The
> five-state version below is kept as the target end-state should we later do the child-invoke.

## The problem

Each subsystem the composer touches is already a clean XState machine in
`src/frontend/src/machines/`:

| Machine | Owns | Surfaces as |
|---|---|---|
| `chatMachine` | agent turn lifecycle (`loading → idle → streaming → refreshing`) | `isStreaming` |
| `realtimeTranscriptionMachine` | mic FSM (`idle / active.{connecting,recording,reconnecting,finalizing}`) | `isTranscribing` |
| `speechPlaybackMachine` | TTS playback (`idle / playing`) | `speechPlaying` |

But the **composer's combined state is not described by any machine.** It is an emergent
cross-product of those three machines stitched together by React `useState`/`useRef` and
`useEffect` glue living in `InteractiveChat-voice.ts` and `InteractiveChat-speech.ts`:

- `useState`: `voicePaused`, `hqInFlight`, `pendingHqDraft`, `narrationEnabled`, `muted`,
  `typingMode`, `typingLocked`, `input`
- coordination refs: `turnTakingRef`, `voicePausedRef`, `speechPlayedRef`, `stopTickRef`,
  `playedSegmentCountRef`
- the coordination *rules* (pause mic when TTS starts, resume on complete, suppress TTS while
  a transcript is active, restart mic after a refresh) live in `useEffect` bodies, not in
  machine guards/actions.

Consequences: the mic button's title is computed from a four-way priority cascade reading
three sources; `voicePaused` is consumed as `voicePaused && speechPlaying` in
`InteractiveChat-view.tsx` (so the internal ref and the rendered state can disagree between TTS
segments — a latent flicker); and the SpeechMenu "Stop resumes the mic" fix had to be a
hand-written `if (voicePausedRef.current)` branch in `handleStopSpeech`.

## The core reframe

Most of the pain is **modeling mutually-exclusive things as independent booleans.** You cannot
be dictating while TTS plays — TTS *pauses* the mic. So `isTranscribing`, `speechPlaying`, and
`voicePaused` are not three booleans; they are **one exclusive region with four states**:

```
                    ┌──────────────────────────── voice region ───────────────────────────┐
                    │                                                                       │
   START_DICTATION  │                          SPEECH_QUEUED                               │
   ┌───────────────▶│  ┌──────────┐  (transcript empty,  ┌────────────────┐                │
   │                │  │ dictating│────agent spoke)──────▶│ pausedForSpeech│                │
 ┌─┴──┐  SPEECH_    │  │(child:   │◀───PLAYBACK_COMPLETE──│ (child:        │                │
 │idle│──QUEUED────▶│  │ transcr.)│◀───STOP_SPEECH────────│  playback)     │                │
 └─▲──┘ [!muted]    │  └──┬────▲──┘    RESUME             └────────────────┘                │
   │                │     │    │                                                            │
   │  PLAYBACK_     │ KEYWORD  │ (restart: "keep talking")                                  │
   │  COMPLETE      │ _SEND    │                          ┌──────────┐                      │
   │  [!turnTaking] │     ▼    └──────────────────────────│ speaking │                      │
   └────────────────┼─ committing ──(doSend, maybe HQ)    │ (child:  │◀── SPEECH_QUEUED     │
                    │                  PLAYBACK_COMPLETE──▶│ playback)│    while idle        │
                    │                  [turnTaking]        └──────────┘                      │
                    └───────────────────────────────────────────────────────────────────────┘
```

`pausedForSpeech` and `speaking` both have TTS playing; the only difference is *intent to
resume the mic afterward* — today that is `voicePausedRef.current`, and in the machine it is
simply **which state you are in**. The mic button's four titles map **one-to-one** onto the
four voice states, which is the strongest evidence the decomposition is correct:

| voice state | mic icon | mic title |
|---|---|---|
| `pausedForSpeech` | pulsing pause | "Resume recording (stops speech)" |
| `dictating` | red stop square | "Stop recording" |
| `idle`/`speaking` + narration | narration mic | "Voice input (narration mode)" |
| `idle`/`speaking` | plain mic | "Voice input" |

## Shape

One **parallel** machine. Regions are the things that are genuinely orthogonal; the existing
machines are reused unchanged as **invoked child actors**.

```ts
const composerMachine = setup({
  types: {
    context: {} as {
      narration: boolean;       // was: narrationEnabled (persisted setting)
      muted: boolean;           // was: muted (persisted setting)
      turnTaking: boolean;      // was: turnTakingRef — "voice conversation active, auto-restart mic"
      pendingHqText: string | null; // was: pendingHqDraft
      // draft (the textarea text) stays component-owned useState — see "draft" below.
    },
    events: {} as
      | { type: "START_DICTATION" } | { type: "STOP_DICTATION" }
      | { type: "KEYWORD_SEND"; text: string; audioBlob: Blob | null }
      | { type: "MESSAGE_SENT" }   // typed send or voice commit — closes an unlocked keyboard
      | { type: "SPEECH_QUEUED"; segments: SpeechSegment[]; messageId: string }
      | { type: "STOP_SPEECH" } | { type: "RESUME" } | { type: "PLAYBACK_COMPLETE" }
      | { type: "HQ_DONE" }
      | { type: "TOGGLE_NARRATION" } | { type: "TOGGLE_MUTE" }
      | { type: "OPEN_KEYBOARD" } | { type: "CLOSE_KEYBOARD" } | { type: "TOGGLE_LOCK" },
  },
  actors: {
    transcription: realtimeTranscriptionMachine,  // reused as-is
    playback: speechPlaybackMachine,              // reused as-is
    speechDispatcher,                             // NEW: watches streamText → raises SPEECH_QUEUED
  },
}).createMachine({
  type: "parallel",
  states: {
    voice: { /* idle | dictating | committing | speaking | pausedForSpeech */ },
    hq:    { initial: "idle", states: { idle: {}, inFlight: { on: { HQ_DONE: "idle" } } } },
    keyboard: { /* closed | open.{unlocked,locked} — mobile only */ },
  },
});
```

### `voice` region (the substance)

`dictating`/`speaking`/`pausedForSpeech` **invoke** the existing transcription / playback
machines and read their sub-states for display — the parent never re-enumerates
`connecting/recording/reconnecting/finalizing`; that stays inside its own machine.

- **idle**
  - `SET_DRAFT` → internal (assign `draft`)
  - `START_DICTATION` → **dictating** (`turnTaking = true`, unlock audio)
  - `SPEECH_QUEUED` → `[muted]` internal (markPlayed) · else → **speaking** (enqueue + play)
- **dictating** *(invoke transcription)*
  - `KEYWORD_SEND` → **committing**
  - `STOP_DICTATION` (manual stop / Esc / cancel) → **idle** (move transcript → `draft` or
    discard; clear dictation draft)
  - `SPEECH_QUEUED` → `[muted]` markPlayed · `[transcript has text]` markPlayed (suppress) ·
    else → **pausedForSpeech** (cancel transcriber, play)
- **committing** *(transient)*
  - entry: `doSend(message)`; if `narration && audioBlob` → raise `START_HQ` to `hq`, set
    `pendingHqText`
  - always → **dictating** (restart mic — "keep talking")
  - *HQ slow-path identity:* because the mic restarts immediately, a second utterance can begin
    before the first's HQ transcript lands. The HQ request must therefore carry its own frozen
    payload (text + the `selectionsSnapshot` that `runKeywordSend` already captures), so its
    deferred submit and `HQ_DONE` don't mingle with the next utterance. This is an
    implementation detail of the `hq` actor, not a separate state — externally it only shows as
    the badge's `transcribing…` sub-label.
- **speaking** *(invoke playback)*
  - `PLAYBACK_COMPLETE` → `[turnTaking]` **dictating** · else **idle**
  - `STOP_SPEECH` → **idle** (stop playback)
  - `START_DICTATION` → **dictating** (stop playback first — closes the rare
    `isTranscribing && speechPlaying` edge)
  - `SPEECH_QUEUED` → internal (enqueue more segments)
- **pausedForSpeech** *(invoke playback)*
  - `PLAYBACK_COMPLETE` → **dictating** (auto-resume mic)
  - `RESUME` → **dictating** (stop playback)
  - `STOP_SPEECH` → **dictating** (stop playback) ← the SpeechMenu Stop fix, now free
  - `SPEECH_QUEUED` → internal (enqueue)

### `hq` region (parallel)

`idle ↔ inFlight`. Entered on the narration HQ round-trip raised by `committing`; the header
`🎙️ narration · transcribing…` badge reads `hq.inFlight`. Orthogonal to `voice` because the
mic has usually re-armed (`dictating`) while the HQ request is in flight.

### `keyboard` region (parallel, mobile) — **in scope**

Models `typingMode`/`typingLocked`:

```
keyboard (initial: closed)
  closed:        on OPEN_KEYBOARD → open
  open (initial: unlocked):
    on CLOSE_KEYBOARD → closed
    unlocked:    on TOGGLE_LOCK → locked · on MESSAGE_SENT → closed   // auto-close after send
    locked:      on TOGGLE_LOCK → unlocked                            // stays open after send
```

It coordinates with the voice region in exactly one rendering rule: the mobile textarea row is
visible when **`keyboard != closed` OR `voice == dictating`** (today: `typingMode ||
isTranscribing` in `ChatComposerSection`). That's a selector reading both regions, not a
transition — so the two regions stay independent, which is why this is a clean parallel region.

### The two couplings that matter (and the one that doesn't)

The real interactions are **between playback and recording**, and both are already first-class
inside the `voice` region — no separate "agent" machinery needed:

1. **playback → recording.** `SPEECH_QUEUED` while `dictating` (empty transcript) →
   `pausedForSpeech` (mic cancelled, TTS plays); `PLAYBACK_COMPLETE` → `dictating` (mic resumes).
2. **recording → speech output.** `SPEECH_QUEUED` while `dictating` *with a non-empty transcript*
   → **suppressed** (`markAsPlayed`, never plays). The act of talking silences the agent's voice.

Neither is mediated by whether the agent is streaming. The agent turn (`chatMachine`) stays its
own machine; the "Stop agent" button reads it directly. The **only** thing the composer ever
needed from streaming was a timing hint: `onComplete` restarts the mic only when
`machineState !== "streaming"` (`InteractiveChat-speech.ts:56`), to avoid re-arming it during a
mid-stream playback *gap* — which would churn `getUserMedia` and fire a spurious recording-start
earcon.

**Resolved: dropped.** The double-earcon it prevents isn't audible in practice, so the input
machine carries **zero** streaming-awareness. `speaking → dictating` resumes on `[turnTaking]`
alone. If a mid-stream gap ever produces a noticeable extra earcon, reintroduce the hint raised
by `speechDispatcher` (not by mirroring `chatMachine`).

### Invoked actor: `speechDispatcher`

The "parse `streamText`, dispatch each complete `<speech>…</speech>` as it arrives" logic
(today three `useEffect`s in `InteractiveChat-speech.ts` plus `playedSegmentCountRef`) becomes
an invoked actor that watches the stream and raises `SPEECH_QUEUED`. This is the cleanest home
for the segment-counter bookkeeping and removes the effects entirely.

## What it deletes / fixes

| Today | In the machine |
|---|---|
| `voicePaused` state + `voicePausedRef` | the `pausedForSpeech` state (gone as a variable) |
| `voicePaused && speechPlaying` AND in `-view.tsx`, + between-segments flicker | impossible — you stay in one state until `PLAYBACK_COMPLETE` |
| `handleStopSpeech`'s `if (voicePausedRef.current) resume mic` branch | the `STOP_SPEECH` transition *on* `pausedForSpeech` |
| rare `isTranscribing && speechPlaying` (manual mic-start during playback) | impossible — `speaking → dictating` stops playback on entry |
| suppress-TTS / pause-mic / restart-after-refresh `useEffect`s in `-speech.ts` | declarative guards + actions on `SPEECH_QUEUED` |
| 4-way mic-button title cascade reading 3 sources | one `state.matches("voice.X")` read |
| `turnTakingRef`, `speechPlayedRef`, `playedSegmentCountRef` | `turnTaking` context + state inside `speechDispatcher` |

### View selectors become trivial reads

```ts
micButton        = voice state (+ narration)            // table above
showStopSpeech   = voice ∈ {speaking, pausedForSpeech}
showStopAgent    = context.agentStreaming
textareaReadOnly = voice === "dictating"                // shows live transcript
sendEnabled      = draft.trim() !== "" && voice !== "dictating"
narrationBadge   = context.narration (+ hq.inFlight sub-label)
muteIcon         = context.muted
```

## Integration plan (if built)

1. Add `composerMachine.ts` in `src/frontend/src/machines/`, invoking the existing
   transcription + playback machines as children (they do **not** change).
2. Add the `speechDispatcher` actor (lift the three `-speech.ts` effects into it).
3. Replace the internals of `useChatVoice` (`InteractiveChat-voice.ts`) with a thin
   `useComposerMachine` wrapper exposing the same return shape the view consumes today, so
   `InteractiveChat-view.tsx` changes minimally at first.
4. Delete `voicePaused`/`voicePausedRef`/`turnTakingRef`/`speechPlayedRef`/
   `playedSegmentCountRef` and the `voicePaused && speechPlaying` AND in the view.
5. Behavior-preserving target: every state in `composer-states.md` still reachable and
   rendered identically (the doc doubles as the acceptance checklist), plus the flicker and the
   manual-start edge are gone.

## Decisions (resolved in discussion)

1. **`keyboard` region — in the machine.** Modeled as a parallel region (above), coordinating
   with `voice` only through the row-visibility selector.
2. **`agentStreaming` — not a region, not context, not even a hint.** The agent turn stays in
   `chatMachine`; the input machine has zero streaming-awareness. The `moreSpeechExpected` timing
   hint was dropped (double-earcon not audible in practice).
3. **`draft` — component-owned `useState`, not machine context.** *Rationale:* no modal
   transition depends on the textarea's *content*. `sendEnabled` is a render guard (not a
   machine transition), and the two places that move text — committing a transcript into the box
   on stop-and-edit, clearing it on send — are one-shot actions the machine fires via injected
   callbacks (`appendDraft(transcript)` / `clearDraft()`). Keeping draft out avoids routing every
   keystroke through the machine (the only real cost of putting it in) while losing nothing,
   because the machine never *branches* on draft text. If a future transition ever needs to read
   draft content, revisit.
4. **`speechDispatcher` — inside the machine** as an invoked actor (lifts the three `-speech.ts`
   mid-stream effects + `playedSegmentCountRef`).

## Open question still on the table

- **Migration shape** — one big swap vs. an incremental wrapper (integration step 3): introduce
  `composerMachine` behind a `useComposerMachine` hook that preserves `useChatVoice`'s current
  return shape, so `InteractiveChat-view.tsx` barely changes at first, then delete the loose
  state in a follow-up. Lower risk; recommended.

## Non-goals

- Re-architecting `chatMachine` / the SSE pipeline.
- Changing any user-visible behavior beyond removing the flicker and the latent
  `isTranscribing && speechPlaying` edge.
- The mobile keyboard's visual treatment (a region models its *state*, not its styling).
