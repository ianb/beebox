---
title: "iOS: swipe-typing (QuickPath) leaves the cursor behind instead of advancing"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder swipe-typing in the native iOS composer
---

Swipe-typing a word on the iOS keyboard (QuickPath / glide typing) inserts the
word but the cursor doesn't properly advance past it — so the next swiped word
lands in the wrong place. Native composer only.

## Cause (from reading the code)

`ios-app/CallbackBox/Views/ComposerTextView.swift` is a `UITextView` wrapped in
SwiftUI with **two-way bindings for both text AND selection**, and
`updateUIView` (lines 34-49) forces the caret on every reconcile:

```swift
if textView.text != text { textView.text = text }
let desiredSelection = selection.clamped(to: text)
if textView.selectedRange != desiredSelection {
    textView.selectedRange = desiredSelection   // <- clobbers the native caret
}
```

Swipe-typing is a **compound native op**: it inserts a whole word AND advances
the caret to end-of-word in one step. That fires `textViewDidChange` (pushes
`parent.text`, line 58) and `textViewDidChangeSelection` (pushes
`parent.selection`, line 63) as **two separate** SwiftUI state mutations. Between
them, SwiftUI re-runs `updateUIView` with the **new text but the stale
`selection`**, computes `desiredSelection` from the old caret, and forces
`selectedRange` back — snapping the cursor behind the just-inserted word. This is
the well-known SwiftUI ↔ UITextView caret-fighting race; compound inputs
(swipe, autocorrect, dictation) trigger it because text and caret change together
but the round-trip reconciles them against a stale snapshot.

## Fix direction

The rule: **`updateUIView` must not impose `selectedRange` for user-driven
edits** — only when it also imposed the text (a genuine external/programmatic
update). Trust the native caret otherwise.

- Guard the selection assignment behind "did we just replace the text
  externally" — e.g. only set `selectedRange` in the same branch where
  `textView.text != text` forced a text change; skip it when the text already
  matches (the user typed/swiped).
- Or track edit origin (a coordinator flag set in the delegate callbacks) and
  have `updateUIView` skip caret reconciliation for user-originated changes.

Either way, remove the unconditional per-reconcile caret write.

## Verification

Needs a **real device or simulator with QuickPath** — this can't be caught in a
headless test, and it's the same class of "compound input" bug that will also
show with autocorrect replacements and dictation, so test those too (swipe a
word, autocorrect a word, dictate a phrase; confirm the caret ends up after the
inserted text each time and the next input lands correctly).

Squarely inside the active
[iOS input-plane parity](../features/2026-07-19-ios-input-plane-parity.md) work —
fix it there, since that effort owns the native composer.
