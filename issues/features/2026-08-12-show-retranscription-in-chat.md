---
title: "Show a retranscription in chat — an indicator, and the improved text in place"
workstream: transcript-confidence
area: callback-box
needs: [manual-testing]
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

> **⏳ Awaiting manual testing** — implemented on `worktree-transcript-confidence`
> (design: `callback-box/docs/implemented-plans/retranscription-in-chat.md`; commits
> `60358e66`…`d4ae8649`); see [Manual testing](#manual-testing). Only the
> developer clears this.

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

## Manual testing

What shipped: voice messages carry a `message-id` address on their `<speech>`
wrapper; the audio commands require `--message <id>` (bare invocations error
with instructions; the wrong-recording/cross-user race is closed by
answer-by-key with echo-and-verify); successful `retranscribe` runs swap the
corrected text onto the bubble with a ✎ badge (popover: service + the original
realtime transcript); `ask-about-audio` adds a 🎧 badge. Transient by design —
a reload reverts to the original text (accepted; the persisted `message-id`
leaves a durable-overlay extension open).

To try (needs a real microphone):

1. Dictate a mumbled message; ask the agent to double-check it. It should run
   `cb chat retranscribe --message <id>` (watch that it targets rather than
   errors), and the bubble should swap to the corrected text with the ✎
   badge; the popover shows the realtime original, readable (no raw
   `<unsure>` tags).
2. Ask a question about the audio itself ("did I sound annoyed?") — 🎧 badge
   on the message after the agent answers.
3. Dictate two messages, then have the agent retranscribe the FIRST — the
   swap must land on the first bubble, not the latest (this is the
   wrong-recording fix).
4. Two tabs/sessions (or a second user): the retranscription shows in the
   session it belongs to, including on the other participant's view of the
   bubble; other sessions see nothing.
5. Reload: overlay reverts by design — confirm it reads acceptably.
6. Watch mark volume of the agent's targeting behavior: a bare command in the
   agent transcript means the prompt guidance needs strengthening.

## Why it's worth doing

The chat prompt (`src/core/chat/session/prompts.ts:53`) actively tells agents to
reach for this — for homophones, dropped negatives, and when the sound itself is
the subject. So it's meant to be routine, and every routine use currently
diverges what the user sees from what the agent read. That gap is exactly where
"the agent misunderstood me" turns into a mystery neither side can see.
