---
description: "Put the box in a chat several people are already in, so one calendar, one set of lists, and one memory serve the whole household."
---
# A household in one chat

Several people, one set of arrangements: who is driving, what is on the list,
when the appointment is. It lives in one person's head and in three apps. A
**box** is one directory of shared data, a **card** is one markdown file in it,
and **the agent** is the coding agent that participates in the chat as a member.

**What you do.** Connect a Telegram chat (a bot token from BotFather, pasted into
the box's admin page), or use the web chat. The owner invites each person with a
single-use invite, and the person sets their own password. After that everyone
asks the box things where they already are: ask what is on the calendar, say to
add lunch on Thursday. Telegram carries text only (a photo needs a caption to
be seen); the posted work schedule gets photographed from the phone capture
page or the web chat instead.

**What the box does.** Incoming messages accumulate on a chat-thread card, one
per chat, and each new message creates a job for the agent. Replies are written
as telegram-message cards and sent the next time the box checks in with
Telegram. The calendar connector mirrors Google Calendar, keeping one file per
event in the standard calendar-file format other apps use (`.ics`, for the
curious), and pushes local changes back. Lists and answers are cards everyone in the box can see.

**What sharing actually means.** A box has exactly one granularity of
sharing: everyone in it shares everything in it, and different groups need
different boxes. Accounts exist (invites, per-person passwords, owner-issued
resets, an allowed-users list), but per-member identity beyond that allowlist is
not designed: no per-person permissions, no private corner, no separate view. The
household in [architecture chapter one](../architecture/01-what-is-this.md) is
the design target, not what runs today.

**What it needs.** A Telegram bot token, or the web app reachable by each device;
a Google account for calendar. [Telegram](../capabilities/telegram.md),
[calendar](../capabilities/calendar.md),
[Telegram setup](../install/telegram.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** Telegram delivery happens on a connector run, so
messages are not instant unless something is waking the box. Calendar scheduled
sync is off by default, the push-back direction has had much less use than the
pull, and there is no month view. Member management is verified in the code
rather than watched working.

**Read next.** [Chat](../capabilities/chat.md),
[why a box has one identity](../design/identity.md),
[chat-thread](../reference/cards/chat-thread.md),
[telegram-message](../reference/cards/telegram-message.md),
[person](../reference/cards/person.md).
