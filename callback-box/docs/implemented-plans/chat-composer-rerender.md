---
title: "Plan: stop composer keystrokes from re-rendering chat history"
status: implemented
workstream: unknown
issues: []
---
# Plan: stop composer keystrokes from re-rendering chat history

## Goal

Typing in the chat composer should re-render the composer subtree only, not
reconcile the entire loaded message history on every keystroke. No behavior
change to streaming, scrolling, or speech playback.

## Evidence (live profiling, main checkout, ~13-message session, 6 markdown blocks)

Measured by instrumenting React's `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`
plus a `MutationObserver` on the chat scroller, driving real keystrokes via
`bin/browse`:

- **One keystroke = exactly 1 React commit** of the whole `InteractiveChat`
  subtree. Confirmed the input registered (textarea value changed; `input`
  state `"" -> "x"` propagating `InteractiveChatBody → ComposerRegion →
  ChatInputArea → DesktopComposerRow`).
- **Zero DOM mutations** in the message scroller per keystroke; all 6 stamped
  `.prose` nodes survive with identity intact.
- **Per-commit render time: [1.9, 2.3, 0.5, 0.6, 0.3] ms** across 5 keystrokes.

Conclusion: the whole history reconciles on every keystroke but produces
identical DOM (no remount, no DOM thrash). Pure wasted reconciliation CPU,
~O(rendered messages). Modest at this length; scales with a long loaded window
(HISTORY_TAIL + "load older"). The earlier hypothesis of per-keystroke
*remounts* (errored-image reload) does not hold — the DOM node is never
destroyed, so that symptom was a `useEffect` re-firing on an unstable
dependency, already mitigated by the module-level failed-URL cache in
`src/frontend/src/components/ui/Image.tsx`.

## Root cause

`useSpeechPlayback` returns a fresh object literal every render
(`src/frontend/src/hooks/useSpeechPlayback.ts:107`). That single unstable
identity poisons three props that flow into `MessageList`:

- `speechPlayback` (the object itself)
- `handleSkipSpeech` and `handleReplaySpeech`
  (`src/frontend/src/components/chat/InteractiveChat-voice.ts:322–331`, both
  `useCallback` with `speechPlayback` in deps)

It also makes `renderCtx`
(`src/frontend/src/components/chat/InteractiveChat-messages.tsx:195`, lists
`speechPlayback` as a dep) change identity every render.

Prop-identity audit of everything else `MessageList` receives, across a
keystroke (which fires `setInput` in `InteractiveChat`, NOT a `chatMachine`
transition):

- `messages`, `groups`, `streamText`, `streamTools`, `liveTurnId`,
  `totalEntries` — from `chatMachine` context via `useSSRMachine`; stable
  reference when the machine doesn't transition. ✓
- `snapshot` — the whole XState actor snapshot from `useSSRMachine`
  (`InteractiveChat.tsx:79`), passed straight into `MessageList`
  (`InteractiveChat.tsx:240`). Its reference changes only when the actor
  transitions; `setInput` is a separate React `useState` and fires no machine
  event, so the snapshot reference is unchanged across a keystroke. ✓
- `groups` — `useMemo(groupMessages(messages), [messages])`. ✓
- `modelMarkers` — `useState<ModelMarker[]>([])`
  (`InteractiveChat-hooks.ts:110`); stable. ✓
- `onZoomView` — `useCallback([])` (`InteractiveChat-hooks.ts:30`). ✓
- `handleStopSpeech` — `useCallback([composerSend])`
  (`InteractiveChat-voice.ts:316`). ✓
- `onLoadOlder` = `handleLoadOlder` —
  `useCallback([loadingOlder, messages.length, totalEntries, send, sessionId,
  setLoadingOlder])` (`InteractiveChat-actions.ts:160–177`); none change on a
  keystroke. ✓
- `isStreaming`, `processingShown`, `debugView`, `currentUserEmail`,
  `loadingOlder`, `scrollToBottomTrigger`, `proseEnabled`, `pendingHqDraft` —
  primitives / stable values. ✓

So every `MessageList` prop is referentially stable across a keystroke **except**
the three that trace to `useSpeechPlayback`'s return object.

## Change 1 — Stabilize `useSpeechPlayback`'s return

`src/frontend/src/hooks/useSpeechPlayback.ts`, line 107: wrap the returned
object in `useMemo` keyed on its fields:

```ts
return useMemo(
  () => ({ isPlaying, playingMessageId, playingSegmentIndex, remainingCount, playSegments, skip, replay, stop, markAsPlayed }),
  [isPlaying, playingMessageId, playingSegmentIndex, remainingCount, playSegments, skip, replay, stop, markAsPlayed],
);
```

The five callbacks (`playSegments`, `skip`, `replay`, `stop`, `markAsPlayed`)
are already `useCallback`-stable (they depend only on `send` and the singleton
`ttsClient`); the four scalars change only when playback state actually
changes. This restabilizes `speechPlayback`, `handleSkipSpeech`,
`handleReplaySpeech`, and `renderCtx` with no edits in voice.ts or messages.tsx
— they inherit the fix.

**Adjacent wart (fold in, free):** `useSpeechDispatch` passes a fresh inline
`onComplete` arrow to `useSpeechPlayback` every render
(`InteractiveChat-speech.ts:47`), which keys `useSpeechPlayback`'s machine
`input` `useMemo` (`useSpeechPlayback.ts:48`). This does **not** defeat the
memo bailout — `input` only seeds the actor at creation (a changed `input`
doesn't restart it or churn the returned object), and the returned callbacks
don't depend on it. Still, wrap `onComplete` in a `useCallback([composerSend])`
in `useSpeechDispatch` so the `input` memo stops recomputing each render.

## Change 2 — `React.memo` the `MessageList`

`src/frontend/src/components/chat/InteractiveChat-messages.tsx`: wrap the
`MessageList` export in `React.memo` (default shallow prop compare). With
Change 1, during typing all its props are referentially equal → it bails out →
zero history reconciliation per keystroke. The composer subtree still
re-renders (it owns `input`), which is small and bounded.

## Invariants preserved

- **Streaming → finalize** (`components/chat/CLAUDE.md`): during a live turn the
  list's inputs change as the stream advances — `streamText` on each
  `STREAM_TEXT` event, `streamTools` on tool events, `snapshot` on state
  transitions (`liveTurnId` is set on send and held, not per-token). Any of
  these changing makes `memo` see changed props and re-render the list, so the
  live turn is not frozen; the live bubble is rebuilt through `buildDataItems`
  (`InteractiveChat-messages.tsx:144`, `InteractiveChat-message-items.tsx:171`).
  The single stable-key `AssistantMessage` path is untouched.
- **Single scroll controller**: no scroll code changes; `useStickToBottom`
  still lives inside `MessageList` and runs whenever the list legitimately
  renders. No new `scrollTo`/`scrollTop` authority.
- **No remount**: identity/bail-out changes only; nothing changes keys or
  structure.

## Verification

1. `pnpm typecheck && pnpm lint`.
2. **Required regression guard** — re-run the profiler probe (commit counter +
   `MutationObserver`) on the same session: the commit must still fire on
   `InteractiveChat` but `MessageList` and all `GroupItem`s must drop out of the
   per-keystroke render. This is the guard against a future inline prop in
   `MessageListRegion` silently erasing the win — keep the probe recipe in the
   PR/commit notes. Re-measure on a deliberately longer session for the
   high-end number.
3. Streaming still renders live: use the `/fakestream 4000 50 25` helper in the
   test session and watch tokens append in real time.
4. Manual procedure in `docs/chat-scroll-testing.md` (stick-to-bottom,
   scroll-up disengage, load-older anchoring).
5. Speech highlight still tracks the now-playing message (replay a `<speech>`
   message; confirm highlight + skip/stop controls — exercises the
   restabilized `speechPlayback`).

## Scope notes

- Two files, both additive/identity-only. Reversible.
- **Out of scope (deliberately):** per-`GroupItem` `React.memo`. That only helps
  a different case — trimming work when the list legitimately re-renders (e.g.
  during streaming, where all groups currently re-render each frame). It adds
  the burden of stabilizing `renderCtx`/`acks` per item and is not needed for
  the typing cost this plan targets. Candidate follow-up.
