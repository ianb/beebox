---
title: "\"send and close\" is a weak canonical keyword, and the close-mic vocabulary has holes"
workstream: unattached
area: callback-box
needs: [design]
labels: [voice, transcription, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder dissatisfied with the sign-off keyword
---

When the boxholder finishes dictating and wants to hand the turn over — phone
down, walking away — they want to say the thing they would naturally say, and
have the mic actually close. Today the canonical phrase for that is
**"send and close"**, and it doesn't sit right. Separately, the close-mic
keywords look incomplete.

Vocabulary lives in `src/frontend/src/lib/audio/speech-keywords.ts`; the rotating
hint that makes a phrase *canonical* is `WITH_TEXT_HINTS` in
`components/chat/KeywordHint.tsx:9`.

## The canonical phrase is already showing strain

`sendClosePattern` carries a mishearing accommodation:

```
send and close (the)? (mic | microphone | message)
set a closed (the)? (mic | microphone | message)      ← this line
```

`set a closed` is what the transcriber hears when the boxholder says "send and
close." A canonical phrase that needs a misrecognition alias baked into its own
pattern is telling us something: it is hard to hear. That is an argument about
the phrase, independent of whether anyone likes how it sounds.

Note the same pattern already contains **"over and out"** — a sign-off, not a
verb-object command, and the one entry that reads like something a person
actually says when putting the phone down. Worth taking seriously as evidence
about the right register.

## The vocabulary is not self-consistent

`micOffPattern` accepts:

```
microphone off / mic off / turn off (the) (microphone|mic) /
stop (the) (microphone|mic) / stop listening
```

**"close the mic" is not in there** — even though *close* is the verb the
canonical send-and-close phrase teaches. So the system trains one meaning for
"close" and then refuses it standalone. Anyone who learns "send and close" and
later just wants the mic shut will reach for "close the mic" and get nothing.

Other plausible-but-absent forms, worth deciding on rather than accumulating:
"mute" / "mute the mic", "pause listening", "stop recording", "done listening",
"that's it", "I'm done", "goodbye".

## The design questions

- **What register are these commands in?** The set is currently verb-object
  imperatives ("send message", "microphone off") with one sign-off ("over and
  out") smuggled in. Sign-offs may be the more natural register for the
  *terminal* action specifically — you are ending a conversation, not operating
  a device. Picking a register deliberately would settle a lot of these.
- **Which action deserves the easiest phrase?** Plain `send` restarts the mic
  for continuous conversation; `sendClose` ends it. The terminal one is the one
  said while walking away, distracted, phone already lowering — the case with
  the least attention available. It currently has the longest and least
  reliable phrase.
- **False positives are the real budget.** "I'm done" and "that's it" occur in
  ordinary speech; every addition trades a missed command (cost: tap a button)
  against a wrong one (cost: a half-finished message sent, or a mic that dies
  mid-thought). Those costs are not symmetric and the asymmetry should drive
  which candidates get in.
- **Does the hint list teach the right thing?** `KeywordHint` rotates six
  phrases. It is the only place the vocabulary is taught, so whatever is
  canonical there is what gets learned — and what gets said badly if it is hard
  to say.
- **What about closing without sending?** `micOff` closes the mic and keeps the
  draft. That is a distinct intention from cancel/erase, and it is unclear
  whether the current phrasing communicates that the text survives.

## Worth checking during design

Whether the mishearing is specific to one transcription backend. `sendClose` is
matched against the realtime transcript, so the alias may be Deepgram-shaped and
a different backend may fail differently. Related:
[mark low-confidence words in a transcript](../closed/features/2026-08-15-mark-low-confidence-words-in-transcripts.md)
— the same confidence data would show, concretely, how badly the canonical
phrase is being heard rather than leaving it to impression.
