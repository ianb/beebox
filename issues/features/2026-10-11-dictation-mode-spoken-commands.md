---
title: "Dictation mode: speak a command in the middle of dictated content"
workstream: unknown
area: beebox
labels: [voice, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder idea, 2026-10-11
---

**Job:** I dictate a long stream of content and the agent stays silent, as in
narration mode. Sometimes I speak *to the agent* in the middle of it ("put that
in the recipe", "look up the date"). I want those words treated as a command
to act on now, not as more content to capture.

## The name

"Narration mode" does not say who narrates to whom. "Dictation mode" says it:
the person dictates and the agent takes it down. The command handling below
could be added to narration mode, and the mode renamed to dictation mode.
Narration mode today: `beebox/src/core/docs-gen/package-docs/narration-mode-doc.ts`
and `beebox/docs/plans/narration-mode.md`.

## Two ways to find a command

1. **A "do it" keyword (simpler; the boxholder's lean).** A spoken keyword
   sends the message, with a tag that says the words just before the keyword
   are a command. Example: "…and the sauce needs an hour. Add that to the
   lasagna recipe, do it." The agent finds where the command starts; the tag
   gives only a rough boundary. This uses the existing keyword machinery.
   Keywords already arrive as tags such as `<send-message phrase="…" />` and
   `<send-checkpoint-message phrase="…" />` (closed
   [checkpoint keyword](../closed/features/2026-09-30-checkpoint-voice-keyword.md)).
   It probably sends as a checkpoint: the person is still dictating after the
   command. Open: the phrase. It must be rare in normal speech and easy
   to say mid-sentence; "do it" itself is common in speech.
2. **Classify the live transcript.** In addition to keyword spotting, run Jev
   on the last part of the live transcript at a fixed interval. Give it rules
   for speech that leaves the frame (addressed to the agent, imperative,
   about the box, not about the content). When it finds a command, flag it and
   send the message to the agent. No keyword to learn. Costs: a model call
   every interval, latency, false positives during content that is itself
   imperative (a recipe's "add the flour"), and a live transcript of lower
   quality than HQ.

Option 1 can ship first. Option 2 can come later if the keyword is a burden.

## Open questions

- The keyword phrase, and whether it sends a checkpoint or a full send.
- What the agent does after the command: act silently with an `<ack>`, or
  answer in a `<callout>`. Narration rules already allow a callout when
  "the user explicitly asked you for something".
- How HQ retranscription treats the keyword (see
  [keyword finish and HQ fixup](../closed/features/2026-08-06-keyword-finish-and-hq-transcribe-fixup.md)
  and the hq-always workstream's "keyword lost in retranscription" marker).
- iOS parity: the keyword list and mode state cross the bridge
  ([iOS record button does not show mode](../bugs/2026-09-29-ios-record-button-does-not-show-mode-or-state.md)).

Related: [listening/note mode](2026-08-29-listening-note-mode.md),
[voice keyword for photo capture](2026-03-04-voice-keyword-photo-capture.md).
