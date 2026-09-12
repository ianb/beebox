---
description: "A conversational interface to your box, in the browser or on Telegram, that streams the agent's reply and remembers where you left off."
---
# Chat

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Chat is the everyday way you talk to it.

**What it does for you**

- Streams the agent's reply as it is generated, instead of making you wait
  for the whole answer.
- Lets you resume a past conversation, reopen a chat from its card, or pick
  up the most recently active one.
- Scopes a chat to wherever you started it: a card you were reading, a
  directory ("place") in the box, or a page you just clipped from the web.
- Lets you quote a passage out of any card into what you're typing.
- Recovers a message that failed to send instead of losing it, and keeps an
  unfinished draft across reloads.
- Can set a reminder mid-conversation that wakes the same chat back up
  later, optionally with a sound or a spoken announcement.

**What it needs**

Nothing beyond the box itself and a working agent login (Claude Code or
Codex). See [../install/index.md](../install/index.md).

**How it works, briefly**

Every conversation is a durable `chat` card, so it survives reloads and is
browsable like anything else in the box. The agent acts inside a turn and
asks you a question when it is unsure rather than guessing; its mid-turn
work (files touched, background notes) is visible in the transcript. Chat
runs on demand, when you send a message, not on a schedule.

**Limits**

A chat that cannot be resumed (for example, an old session format) says so
rather than silently starting a new, disconnected one. The documentation
does not describe a message-editing feature; a sent message stands as sent.

**Go deeper**

[../reference/cards/chat.md](../reference/cards/chat.md),
[../reference/cards/chat-thread.md](../reference/cards/chat-thread.md),
[../reference/chat-voice.md](../reference/chat-voice.md),
[../reference/narration-mode.md](../reference/narration-mode.md),
[voice.md](voice.md)
