---
description: "Lets you message your box on Telegram from your phone and get the agent's replies there."
---
# Telegram

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Telegram is a way to reach the box that does not require opening a
browser.

**What it does for you**

- Lets you message the box from Telegram, on your phone or desktop, and get
  the agent's replies in the same chat.
- Works in a private chat with the bot or in a group, and the agent can
  choose to stay quiet on group chatter that is not directed at it.
- Delivers proactive messages from the box (a scheduled task's result, an
  alert) to you on Telegram, alongside or instead of browser notifications.
- Catches up on messages sent while your server was offline instead of
  losing them.

**What it needs**

A Telegram bot token, created through Telegram's BotFather and pasted into
the box's admin page; no config file to edit by hand. See the install
directory: [../install/index.md](../install/index.md).

**How it works, briefly**

Incoming messages accumulate on a `chat-thread` card, one per Telegram chat,
and each new message creates a job for the agent to process. Outbound
messages are written as a `telegram-message` card and sent, then deleted,
the next time the connector runs, both to check for missed messages and to send
anything queued.

**Limits**

A message the connector could not deliver is recorded with its error rather
than silently dropped, but it is not retried forever. The documentation does
not describe a way to reach the box over Telegram before a bot is connected
through the admin page.

**Go deeper**

[../reference/connectors.md](../reference/connectors.md),
[../reference/cards/chat-thread.md](../reference/cards/chat-thread.md),
[../reference/cards/telegram-message.md](../reference/cards/telegram-message.md),
[../reference/chat-voice.md](../reference/chat-voice.md)
