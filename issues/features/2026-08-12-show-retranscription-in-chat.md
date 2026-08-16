---
title: "Show a retranscription in chat — an indicator, and the improved text in place"
workstream: unattached
area: callback-box
needs: [design]
labels: [chat, voice, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report
priority: important
---

When the agent runs `cb chat retranscribe`, the user sees nothing. Their message
keeps whatever the on-device transcriber produced — mangled names, a dropped
negative — while the agent quietly works from a better version. So the person is
reading one thing and being answered about another.

Wanted: **an indicator that a retranscription happened, and the improved text
shown in place of the original.**

Extended scope (boxholder, 2026-08-15): the same treatment for **any
agent-side audio consultation** — `cb chat ask-about-audio` should also mark
the message it examined (something small, e.g. an emoticon/icon on the
bubble), so "the agent went back to the recording" is visible even when no
text was replaced. This matters more now that `<unsure>` spans (see
[mark low-confidence words](2026-08-15-mark-low-confidence-words-in-transcripts.md),
shipped) actively prompt the agent to reach for the audio commands — those
consultations should leave a visible trace on the message they checked.

Explicitly **not** required to alter the durable transcript — visual only, in
the chat, is enough.

## The plumbing already exists

The browser is *already* a participant in retranscription. Per
`src/webapp/routes/chat-last-audio-routes.ts`, a box agent fetching the original
recording works by broadcasting a transient `chat-last-audio-request` bus event;
every connected chat tab answers with its cached recording (or "none"), and the
first audio answer streams back to the waiting CLI call — carrying the
recording's metadata in `X-Recorded-At` and `X-Message-Text` headers.

So there is already a request/response conversation between `cb chat
retranscribe` and the tab that holds the audio. Showing the result is an
**extension of a conversation already happening**, not new plumbing: the same
bus can carry a "here is the better text for that message" event back.

`X-Message-Text` is especially useful — the CLI side already knows which
message's audio it asked for, which is most of the identification problem.

## Design questions

- **Which message does it replace?** The last voice message is the common case,
  but `retranscribe` takes `--file`, so it isn't always "the last one". The
  answer probably rides on whatever identified the audio in the first place.
- **What does the indicator say, and can the original be recovered?** Silently
  swapping text the user typed-by-voice is its own small betrayal — they may
  want to see what was changed, especially when the retranscription is *wrong*.
  A marker with the original available on hover/expand keeps both.
- **Visual-only means it doesn't survive a reload.** That's acceptable per the
  boxholder, but decide it deliberately: after a refresh the message reverts to
  the original text with no trace, which could read as the fix being undone.
- **Diarization.** `retranscribe --diarize` exists; a diarized result has a
  different shape than a plain string and may not drop into the bubble cleanly.
- **Failure and latency.** A high-quality pass isn't instant. Does the indicator
  appear while it runs, or only on success? A retranscription that fails should
  leave the original untouched and say nothing rather than leaving a spinner.

## Why it's worth doing

The chat prompt (`src/core/chat/session/prompts.ts:53`) actively tells agents to
reach for this — for homophones, dropped negatives, and when the sound itself is
the subject. So it's meant to be routine, and every routine use currently
diverges what the user sees from what the agent read. That gap is exactly where
"the agent misunderstood me" turns into a mystery neither side can see.
