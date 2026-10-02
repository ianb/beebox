---
title: "A \"checkpoint\" voice keyword: send now, and tell the agent I am still talking"
workstream: unattached
area: beebox
labels: [voice, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder request
---

**Job:** When I dictate a long train of thought, I want to send what I have
so far without ending my turn. Then the agent can start work, or simply hold
the context, and it knows more is coming. It should not answer as if I am
finished.

Today "send message" does two things at once. It sends the text, and it
implies "I am done, respond." The client action is the only thing the
boxholder wants to keep. The new keyword does **exactly the same client
action as plain `send`**: send the message and restart the mic. It is a
different keyword, so the agent sees a different tag.

Keywords reach the agent as tags, for example
`<send-message phrase="..." />`. `narration-mode-doc.ts` documents this
(`beebox/src/core/docs-gen/package-docs/narration-mode-doc.ts:39`). A
checkpoint keyword would arrive as its own tag. The agent guidance would
say what it means: the user sent a partial transcript and expects to keep
talking. Keep the reply short, or acknowledge and wait. Do not treat it as a
completed request.

## Where it lands

- Web patterns: `beebox/src/frontend/src/lib/audio/speech-keywords.ts`
  (`sendPattern` and the others; order in `detectKeyword` matters).
- Keyword-to-action mapping:
  `beebox/src/frontend/src/hooks/useRealtimeTranscription/transcription-keywords.ts`
  and `beebox/src/frontend/src/input/voice-intent.ts`.
- iOS mirror: `ios-app/BeeBox/Services/SpeechKeywords.swift` and its tests.
  This is a shared surface (see the bbx-ios-overlap skill).
- Agent guidance: `narration-mode-doc.ts`, next to the existing trigger-phrase
  paragraph.
- Hint rotation: `WITH_TEXT_HINTS` in `components/chat/KeywordHint.tsx`, if
  it should be taught.

## Open questions

- **Phrase.** Not chosen yet. It must be a two-word (or longer) phrase.
  A single word gives too many false positives: the boxholder may want to talk
  *about* checkpoints, for example. "Checkpoint" is only the working name for
  the feature. Test how the transcriber hears the candidate before committing.
  See the "set a closed" mishearing in
  [the sign-off vocabulary issue](2026-08-16-voice-keyword-vocabulary-close-and-signoff.md),
  which is the same design space. Candidates to test: "more to come",
  "to be continued", "hold that thought", "checkpoint message".
- **Agent behavior.** Should the agent reply at all? Options: a one-line
  acknowledgement, silence (no spoken reply in narration mode), or starting
  work quietly. A reply that is spoken aloud interrupts the user who is still
  talking.
- **Merging.** Should the next message after a checkpoint be shown or treated
  as a continuation of the same thought?
