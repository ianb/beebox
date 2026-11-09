---
title: "bbx chat retranscribe printed garbled text in other scripts as a success, and does not say which service produced it"
workstream: box-feedback-bugs
area: beebox
labels: [transcription]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Garbled_Speech_Retranscription, 2026-11-09"
---

In a chat on a local box, several voice messages started with unrelated
multilingual or repeated text before intelligible English. The boxholder
asked the agent to recover one recording. `bbx chat retranscribe --message <id>`
exited 0 and printed only garbled words in Japanese script and Polish-looking
words, with no English. The realtime transcript in the same output was
better. The agent could not tell why, and did not retry.

## What the command shows

The footer prints `service: (box default)` when no `--service` is given
(`beebox/src/cli/commands/chat/audio.ts:299`). The resolved service name is in
`result.service` and goes only into the retranscription report
(`audio.ts:305-317`). The detected language (`result.language`) is not printed.
So the agent cannot say which HQ service failed, or that it decoded the
audio as another language.

The report is also posted as a correction of the message
(`postAudioReviewReport`), with no check that the new text is better.

## Open questions

- Print the resolved service and detected language in the footer. This is
  small and helps every retranscription.
- Should the command warn, or skip the correction report, when the new text
  is in a different language or script from the realtime transcript?
- Does the HQ request pass a language hint? A hint from the box or from the
  realtime transcript could prevent this decoding. Cause of the garbled
  output is not established; the audio was not examined.

Related: [show a retranscription in chat](../features/2026-08-12-show-retranscription-in-chat.md),
[retranscribe 503 retry signal](../features/2026-09-21-chat-retranscribe-503-no-retry-signal.md).

Boxholder, 2026-11-09: no large changes to retranscribe while the cause is
unknown. No automatic language hint: mixed-language speech is a real use, so
no hint is a valid default. A per-run option to set one (`--language`) may be
worth adding later.
