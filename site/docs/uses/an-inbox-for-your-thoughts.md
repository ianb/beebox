---
description: "Speak or type whatever is in your head and have it come back as todos, notes, and records instead of a pile of fragments."
---
# An inbox for your thoughts

You have thoughts through the day and nowhere good to put them. A notes app
fills with fragments nobody rereads; a todo list wants you to know the shape of
the thing before you can write it down. The friction is the formatting. A
**box** is one directory of your data, a **card** is one markdown file in it,
and **the agent** is the coding agent that reads what you left and decides what
it becomes.

**What you do.** Open the chat, or the capture page on your phone, and talk.
Five seconds or twenty minutes. Pauses are expected, and so are false starts:
"no, I didn't mean that" drops the abandoned thought and keeps the corrected
one. Or type. With a card open you can select a passage and talk about it, and
the selection arrives with what you said.

**What the box does.** A spoken note becomes a memo card carrying its
transcription; a photographed or typed one becomes a memo too. The agent reads
it later and decides what it is: a todo, a record card for a thing you keep
track of, a note appended to a card that already exists, or a question back to
you when it cannot tell. Your own words are kept quoted and are not rewritten
unless you ask. In narration mode the box stays quiet and collects while you
dump.

**What it needs.** Nothing beyond the box for typing. For voice: a microphone
and a transcription vendor key (Mistral, OpenAI, or Deepgram).
[Voice](../capabilities/voice.md), [chat](../capabilities/chat.md),
[phone capture](../capabilities/phone-capture.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** Transcription is a third-party service, so voice
costs a key you supply and works only online; the documentation describes no
offline voice. Words the recognizer was unsure of are marked rather than
silently guessed, so some notes need a second look. Per-message voice settings
apply in chat only. And the box does not anticipate: it will not notice on its
own that a thought you left needs acting on.

**What makes it possible**

- **Capture sessions** ([phone capture](../capabilities/phone-capture.md)): one recording is kept as a single readable timeline, silences and photos in place.
- **Triage** ([triage](../capabilities/triage.md)): anything arriving unsorted is classified and filed with a confidence level, so you never have to pick a destination.
- **The questions loop** ([questions](../capabilities/questions.md)): it asks and waits rather than guessing, and never synthesizes an answer on your behalf.

**Read next.** [Questions](../capabilities/questions.md),
[memo](../reference/cards/memo.md), [audio](../reference/cards/audio.md),
[record](../reference/cards/record.md),
[todo-view](../reference/cards/todo-view.md).
