---
description: "Dictate to the box by voice and have it speak replies back, with per-message control over the voice used."
---
# Voice

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Voice covers both directions: talking to the box and having it talk back.

**What it does for you**

- Lets you dictate a chat message with spoken controls (start, stop, send)
  instead of typing.
- Reads the agent's reply aloud when it is wrapped for speech, in one of
  several available voices, with per-message tone instructions ("gentle, not
  urgent").
- Keeps dictating through a brief network or microphone interruption instead
  of losing the recording, and lets the microphone yield while the box is
  talking so the two don't talk over each other.
- Supports a distinct "narration mode" for long, loose voice dumps: the box
  stays silent and just captures, rather than replying to every aside.
- Flags words the speech recognizer was unsure of, so you know what to
  double check.

**What it needs**

A microphone (browser or phone) for dictation and, for spoken replies, a
working setup that turns text into speech. See [../install/index.md](../install/index.md).

**How it works, briefly**

Speech in either direction is a feature of chat and phone capture, not a
separate surface. A spoken reply is marked in the agent's response with a
speech tag that carries the voice and delivery instructions; a dictated
message arrives as a transcript the agent treats as noisy (punctuation is
machine-inserted, homophones can be wrong) rather than as exact typed text.

**Limits**

Per-message voice overrides only apply in chat, not in background jobs or
procedures. The documentation does not describe offline (no-network) voice
support.

**Go deeper**

[../reference/chat-voice.md](../reference/chat-voice.md),
[../reference/narration-mode.md](../reference/narration-mode.md),
[chat.md](chat.md), [phone-capture.md](phone-capture.md)
