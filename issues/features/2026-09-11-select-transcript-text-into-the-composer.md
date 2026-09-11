---
title: "Selecting text in the transcript should offer the same \"+\" that document selections get"
workstream: unattached
area: beebox
priority: normal
labels: [chat, selection, composer]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "we had a regression where selecting text in the chat doesn't allow you to add it to the context"
---

Selecting text in a chat message produces nothing. The boxholder expected the
floating **"+"** that document selections get, and reasonably read its absence
as a regression.

It never worked. `SelectionCapture` is mounted in exactly one place,
`FileView.tsx:213`, and `git log -S SelectionCapture` over all history returns
no commit that ever placed it in a message component. The feature's design doc
scoped it that way deliberately —
`beebox/docs/implemented-plans/selection-commentary.md`: "a way to attach a text
selection **from an open document** to a chat message. The user selects text in
a document shown in the chat companion pane." On a chat screen with no cards
open, nothing is listening for a selection at all.

That two people (the boxholder, and an agent reading the code) both expected it
to work is the argument for building it: quoting the agent's own words back at
it — "this part, expand on it" — is at least as natural as quoting a document.

## Why it is small

The receiving half already exists and is always mounted. `useCompanionSelection`
runs in `InteractiveChat-view.tsx:262` on every chat page regardless of whether
any card is open, and returns `handleAddSelection` — the same sink the card pane
uses, which inserts a `[selectionN]` token in the composer plus a removable,
viewable pill, and folds correctly into the voice/HQ-transcription paths.
Wrapping the transcript in `SelectionCapture` with that callback is most of the
work.

## What needs deciding first

- **What the position locator means for a message.** For a document it is a DOM
  locator into the file, so the agent can find the passage again. A transcript
  message has no file behind it. Options: anchor to the message id (and let the
  expansion name the turn), or carry verbatim text with no locator at all. This
  decides what the `<selection>` expansion looks like on send, so settle it
  before building.
- **Whose messages.** The agent's replies are the obvious case. Whether your own
  messages should also be selectable is a real question, not an oversight to
  fix silently.
- **Interaction with speech.** `ChatMessages.tsx` already carries a sticky
  speech bar with `pointer-events-none` precisely so it does not block text
  selection. A new floating control in the same region needs the same care.
