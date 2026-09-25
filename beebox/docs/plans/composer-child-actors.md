---
title: "Composer child-actor ownership"
status: draft
workstream: unattached
issues: []
---
# Composer child-actor ownership

This proposal was extracted from the mixed current/future design note in the
[current composer guide](../chat/composer.md). It is not authorized runtime work. The
three-state speech overlay, HQ region, and keyboard transition model have
shipped; invoking transcription and playback as child actors has not.

## Stated preferences this plan trades against

The prior discussion favored one exclusive voice region over independent
booleans, kept textarea draft text component-owned, kept `chatMachine`
separate, and recommended an incremental wrapper that preserves the current
view contract. No newer decision in this extraction changes those choices.

## What already exists

- `src/frontend/src/machines/composerMachine.ts:12`: *"this machine owns only
  the overlay that no existing machine owns"*. Lines 13–17 name the shipped
  `idle | speaking | pausedForSpeech` states and leave recording in
  `realtimeTranscriptionMachine`.
- `src/frontend/src/components/chat/InteractiveChat-voice.ts:111`:
  *"useMachine(composerMachine"*. Lines 115–130 execute the emitted device
  commands against the live handles.
- `src/frontend/src/machines/realtimeTranscriptionMachine.ts:2`: *"XState
  machine for realtime speech-to-text."*
- `src/frontend/src/machines/speechPlaybackMachine.ts:2`: *"XState machine for
  TTS speech playback."*
- `src/frontend/src/components/chat/InteractiveChat.tsx:161`:
  *"const [typingMode, setTypingMode] = useState(false);"* Line 162 does the
  same for `typingLocked`, while
  `src/frontend/src/components/chat/InteractiveChat-layout.tsx:161` renders
  from `typingMode || isTranscribing`.
- `test/frontend/composer-machine.doctest.md:3`: *"composerMachine is the
  coordination overlay"*. Lines 4–8 name the three regions and device seams
  under test.

## Proposed shape

### Child-owned voice lifecycle

The proposed final voice region is
`idle | dictating | committing | speaking | pausedForSpeech`.
`dictating`, `speaking`, and `pausedForSpeech` invoke the existing
transcription or playback machines as child actors. The parent does not
re-enumerate `connecting | recording | reconnecting | finalizing`.

```text
idle → dictating → committing → dictating
  └──── speaking ←──────────────┘
dictating → pausedForSpeech → dictating
```

`pausedForSpeech` and `speaking` both mean playback is active. The former also
records the intent to resume a microphone that playback paused.

The transitions retained from the original design are:

- `idle`: `START_DICTATION` enters `dictating`; unmuted `SPEECH_QUEUED`
  enters `speaking`.
- `dictating`: `KEYWORD_SEND` enters transient `committing`;
  `STOP_DICTATION` returns to `idle`; queued speech is suppressed when a
  transcript has text and otherwise enters `pausedForSpeech`.
- `committing`: send the frozen message payload, optionally start HQ work,
  then restart `dictating` immediately.
- `speaking`: completion returns to `dictating` when turn-taking is active and
  otherwise to `idle`; starting dictation stops playback first.
- `pausedForSpeech`: completion, `RESUME`, or `STOP_SPEECH` stops playback as
  needed and returns to `dictating`.

Each HQ request must retain its own frozen text and selection snapshot so a
later utterance cannot mingle with an earlier request.

### Speech dispatcher

Move the complete-`<speech>…</speech>` segment parsing and played-segment
bookkeeping from React effects into an invoked `speechDispatcher` actor that
raises `SPEECH_QUEUED`. The original design intentionally gave the composer no
`chatMachine` region and no streaming context. If an audible mid-stream gap is
later demonstrated, the dispatcher may raise a narrow timing hint rather than
mirroring the chat machine.

### Keyboard wiring

Wire the existing machine keyboard region to the mobile view, replacing
component-owned `typingMode` and `typingLocked`. Keep the existing rendering
rule: the mobile textarea row is visible when the keyboard is open or the
transcription machine is active.

## Expected simplifications

If built, the child-owned states replace the remaining mirrored voice state and
coordination effects. The mic button can read the exclusive voice state;
`STOP_SPEECH` on `pausedForSpeech` encodes the resume behavior; and manual mic
start during playback becomes a transition that stops playback first.

Textarea draft remains component-owned. No modal transition branches on its
contents, so routing every keystroke through the machine adds cost without
clarifying a transition.

## Integration order

1. Add child actors behind a `useComposerMachine` wrapper that preserves
   `useChatVoice`'s current return shape.
2. Move speech dispatch and remove the remaining mirrored voice coordination
   state.
3. Wire mobile keyboard rendering to the existing keyboard region.
4. Keep the rendered states in `composer-states.md` reachable and unchanged.

## Decisions retained from the original discussion

- Keep the keyboard region in the machine; it is orthogonal to voice except
  for the view selector.
- Keep `chatMachine` separate and do not mirror agent streaming into composer
  state.
- Keep textarea draft component-owned until a machine transition needs its
  contents.
- Put `speechDispatcher` inside the composer as an invoked actor.
- Prefer the incremental wrapper migration over one large swap.

## Open design question

The exact incremental boundary still needs source review if this draft is
activated. The original recommendation was to preserve the current hook return
shape first, then delete loose state in a follow-up chunk.

## Non-goals

- Re-architecting `chatMachine` or the SSE pipeline.
- Changing user-visible behavior beyond removing coordination races.
- Changing the mobile keyboard's visual treatment.
- Implementing any part of this proposal during documentation cleanup.
