---
title: "iOS: a voice keyword leaves its tag in the composer when the send lock is stuck, and repeats nest the tags"
workstream: unattached
area: callback-box
labels: [ios, voice, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report from the iOS app
---

Saying **"clear message"** on iOS puts the literal text
`<erase-message phrase="Clear message" />` into the composer instead of erasing
the draft. Saying it again nests tags inside tags. Voice output also continues
while the composer holds text, which normally suppresses it.

The boxholder suspected this was downstream of the stuck "Sending message…"
bug. It is — the mechanism is exact.

## Mechanism

`ios-app/CallbackBox/Views/NativeComposerView.swift:442-456`:

```swift
private func handleKeywordIntent(_ intent: SpeechKeywordResult) {
    dictation.clearKeywordIntent()
    if isSending {
        statusText = batchProgress == nil
            ? "Still sending — try again in a moment."
            : "Photos are still uploading — try again when they finish."
        applyEarcon(.microphoneStopped)
        applyVoiceTurn(.microphoneStopped)
        return
    }
    switch intent.action { … case .erase: … }
}
```

`isSending` gates every spoken command, and returns **before** the `.erase`
handler that would discard the draft. Meanwhile the keyword pipeline has
already replaced the matched phrase with its tag —
`SpeechKeywords.swift:154` builds `processedTranscript` via
`match.replaceTrimmed(with: keywordTag(...))` — and that text is already in the
composer. So the refusal drops the *action* and keeps the *tag*.

Three consequences, in order of how bad they are:

1. **The lock can be stuck forever.** `isSending` staying true is the same
   condition as
   [stuck "Sending message…"](2026-08-18-ios-stuck-sending-message-survives-restart.md),
   where an emission never leaves `.awaitingReceipt` and survives app restarts.
   So "try again in a moment" is a promise the app cannot keep — the correct
   status would be closer to "this will not clear until the stuck send is
   resolved," and there is currently no way for the user to resolve it.
2. **Repeats nest.** Detection runs over composer text that already contains a
   tag, and nothing rejects or strips an already-tagged input, so each repeat
   substitutes inside the previous substitution. The parser has no notion that
   its own output is not valid input.
3. **The tag is user-visible at all.** `<erase-message …/>` is a marker for the
   persisted message record, not composer content. Whatever the lock does, a
   control tag sitting in the text box is wrong on its face.

## The lock itself is right

Worth stating so nobody "fixes" this by removing it. Its comment explains the
reasoning: without it, a spoken "send" would enqueue an overlapping message and
"cancel"/"erase" would discard the draft a running batch upload is using as its
introduction — a voice path doing what the visibly-disabled buttons cannot. The
defect is what happens to the *text* when the lock refuses, not the refusal.

## Fix directions

- **Refuse before substituting, or undo the substitution on refusal.** The tag
  should never reach the composer for a command that did not run. This is the
  narrow fix and it resolves symptoms 1 and 3.
- **Make detection reject already-tagged input**, so a repeat cannot nest even
  if something else goes wrong. Cheap, and it bounds the damage class.
- **Give the user an escape.** A stuck `isSending` currently disables every
  voice command with no recovery. Whatever staleness rule resolves the pending
  emission also unblocks this.
- **Check the web path for the same shape.**
  `src/frontend/src/lib/audio/speech-keywords.ts` and `input/voice-intent.ts`
  are a parallel implementation; if it has an equivalent in-flight guard placed
  after substitution, it has this bug too and nobody has hit it yet.

## Also reported, likely separate

**Voice output continues while the composer holds text**, which normally
suppresses it. Worth confirming whether the suppression rule keys off the
composer being non-empty — in which case a composer full of leaked tag text
*should* have suppressed narration and didn't, making this a third symptom of
the same wedged state rather than an independent bug.
