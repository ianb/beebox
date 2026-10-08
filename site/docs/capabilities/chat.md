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
- Recovers a message that failed to send instead of losing it, offering to
  retry it, put it back in the box as a draft, or discard it, and keeps an
  unfinished draft across reloads.
- Searches what was said in your chats, not only their titles: a search field
  on the Recent chats panel returns one row per chat with a highlighted snippet,
  and opening a result lands on the matching message.
- Lets you mark a chat done (the menu says "Archive conversation"). It stays
  resumable and moves out of the Recent chats list into an "All chats" view.
  Deleting a chat is a separate, permanent act: the transcript and the chat's
  card are removed, while cards and files the conversation produced, and
  earlier committed versions in git, stay.
- Titles chats for you as they grow, including short ones, and keeps a title
  you set by hand.
- Shows the agent's short progress remarks between its tool steps, live and
  later in the transcript, so a long turn does not look silent.
- Keeps an image you paste or upload as a file the agent can use (crop it,
  read text from it, file it into a card), as well as showing it to the agent.
- Lets you pick the model for one chat, from the engines the box has enabled
  or a model the owner added through OpenRouter, and marks a chat running
  above or below the box default.
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
The box screen sends a thought to whichever chat it fits (quick chat); see
[web-interface.md](web-interface.md). A box with no working agent login shows a
notice in place of the message box and sends the owner to the Admin page to
connect one.

**Limits**

A chat that cannot be resumed (for example, an old session format) says so
rather than silently starting a new, disconnected one. The documentation
does not describe a message-editing feature; a sent message stands as sent.
Chat search matches the words as typed and does not understand meaning, by
choice, so that your transcripts are not sent to an outside service to build
it; it covers only chats on the machine the box runs on, and only the text you
and the agent wrote, not tool output or attachments. Searching chats from the
box-wide search is not built.

**Go deeper**

[../reference/cards/chat.md](../reference/cards/chat.md),
[../reference/cards/chat-thread.md](../reference/cards/chat-thread.md),
[../reference/chat-voice.md](../reference/chat-voice.md),
[../reference/narration-mode.md](../reference/narration-mode.md),
[voice.md](voice.md)
