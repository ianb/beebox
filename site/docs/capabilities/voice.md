---
description: "Dictate by voice with spoken start, stop, and send controls, and hear the agent's replies spoken back in a chosen voice and pace."
---
# Voice

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Voice is a first-class way in and out of the box, on both desktop and
phone, not a bolt-on to typing.

**What it does for you**

- Dictate a chat message with spoken controls: say "send message," "erase
  message," or "microphone off" instead of reaching for the screen.
- Keeps dictating through a brief network drop or the microphone getting
  grabbed by something else, instead of losing what you said.
- A narration mode for long, loose voice dumps: the box stays quiet,
  transcribes, and files what you said rather than chatting back line by
  line.
- A voice memo recorded on the phone becomes an audio card with a transcript
  and a short summary once transcription finishes.
- A capture session groups a burst of photos and spoken remarks from one
  sitting into a single readable timeline.
- The agent's replies can be spoken aloud, and the agent chooses the voice,
  pacing, and emphasis for each spoken reply, not just one fixed narrator.
- Short sounds (earcons) mark recording start, stop, failure, and send, so
  you know the state of the microphone without looking.
- On the phone, speech recognition runs on the device itself.
- Your exact spoken words are kept as a quote when the agent turns them into
  a card or note, not smoothed into the agent's own phrasing. See
  [provenance.md](provenance.md).

**What it needs**

A transcription vendor key for accurate, high-quality transcription: OpenAI,
Mistral, or Deepgram. A microphone, in the browser or on the phone. The
iPhone app for on-device speech recognition. A text-to-speech provider for
spoken replies: OpenAI, or Gemini through OpenRouter. See
[../install/index.md](../install/index.md).

**How it works, briefly**

Recording happens in the browser or the iPhone app. The recording is
transcribed by the vendor key you've configured, or on-device on the phone,
and the transcript becomes a chat message or a card. A spoken reply comes
from a delivery instruction the agent writes into its response, naming the
voice and how to say it; the box turns that into audio.

**Limits**

Per-message voice overrides only apply in chat, not in background jobs or
procedures. The documentation does not describe offline (no-network) voice
support.

**Go deeper**

[chat.md](chat.md), [phone-capture.md](phone-capture.md),
[provenance.md](provenance.md),
[../reference/chat-voice.md](../reference/chat-voice.md),
[../reference/narration-mode.md](../reference/narration-mode.md),
[../reference/cards/audio.md](../reference/cards/audio.md),
[../reference/cards/capture-session.md](../reference/cards/capture-session.md)
