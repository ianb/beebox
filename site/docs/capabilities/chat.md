---
description: "A conversational interface to your box, in the browser, that streams the agent's reply and remembers where you left off."
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
- Lets you point at part of a document open beside the chat. Select mode, in
  the chat's top row, outlines a block as you hover (on desktop) and attaches
  it to your draft when you click; on a touch screen a tap outlines the block
  and the `+` beside it attaches it. The attached block shows as a removable
  mark in the draft, and you can type or dictate around it. It applies to
  rendered document cards, not to PDFs or images, and selecting does not
  authorize the agent to act.
- Recovers a message that failed to send instead of losing it, offering to
  retry it, put it back in the box as a draft, or discard it, and keeps an
  unfinished draft across reloads.
- Marks a message the agent never received (for example, one still waiting
  when the box restarted) as not delivered, at the place you sent it, with
  Resend and Discard. A message that is only waiting behind the current reply
  is shown as queued, not as failed.
- Searches what was said in your chats, not only their titles: a search field
  on the Recent chats panel returns one row per chat with a highlighted snippet,
  and opening a result lands on the matching message.
- Lets you mark a chat done (the menu says "Archive conversation"). It stays
  resumable and moves out of the Recent chats list into an "All chats" view.
  Deleting a chat is a separate, permanent act: the transcript and the chat's
  card are removed, while cards and files the conversation produced, and
  earlier committed versions in git, stay.
- Tells a chat when its background work was cut off. The agent can leave
  helpers running after a turn ends, and a deploy, a reload, or a server
  shutdown ends them. The box now waits for chats with live background work
  before routine maintenance, and when an interruption does happen the chat
  is told why and when on its next turn. A chat interrupted from outside also
  wakes itself once (at most twice a day) so the agent can restart, drop, or
  ask about the unfinished work without waiting for you to write first. A
  message you send while the box restarts is queued, not dropped, and a chat
  you return to after a long absence says "Catching up…" until its history
  loads.
- Titles chats for you, starting right after the first exchange or two
  rather than overnight, retitling as they grow, and keeps a title you set by
  hand.
- Shows the agent's short progress remarks between its tool steps, live and
  later in the transcript, so a long turn does not look silent. The
  collapsed activity row names the newest remark and the step count; opened,
  each remark heads a stage with the steps it led to under it. Steps of a
  Codex turn are named from what the command did (read, searched, listed) once
  the turn has finished, and a command with no known meaning reads "Took a
  step".
- Sets math as math: `$E = mc^2$` in a line, `$$ … $$` as a displayed formula,
  and chemistry such as `$\ce{2H2 + O2 -> 2H2O}$`, in chat and in card
  bodies. Dollar amounts ("$5 and $10") stay text, and TeX that does not parse
  shows its source in code style. Pages published from the box render the same
  math ([publishing.md](publishing.md)).
- Lets the agent link to a view in a particular state (a filter, a tab, a
  date). If that view is already open beside the chat, the link moves it in
  place instead of reloading it.
- Can dock one card across the top of the page, the strip, that stays put
  whichever of the cards or the messages you are looking at. The first card
  type built for it is a tour, a list of steps with one marked current, which
  the agent keeps current while you present your box or are walked through it;
  a box can add its own types. The agent sets it only when you ask for a
  walk-through, a presentation, or the strip by name, and one click dismisses
  it. The card stays in the box.
- Keeps an image you paste or upload as a file the agent can use (crop it,
  read text from it, file it into a card), as well as showing it to the agent.
- Lets you pick the model for one chat, from the engines the box has enabled
  or a model the owner added through OpenRouter, and marks a chat running
  above or below the box default.
- Can come back to the same chat later, up to twelve hours out, to check on
  something ("ring in this chat in 20 minutes"), optionally with a sound or a
  spoken announcement. For anything further out, or to reach you when the chat
  is closed, the agent sets a reminder on your phone instead
  ([notifications.md](notifications.md)), and tells you the time it set so you
  can correct a misread "next Tuesday".

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

The not-delivered mark is kept for at most 24 hours, and a crash (as opposed
to a restart) loses a queued message without leaving the mark. A chat that
cannot be resumed (for example, an old session format) says so
rather than silently starting a new, disconnected one. The documentation
does not describe a message-editing feature; a sent message stands as sent.
Chat search matches the words as typed and does not understand meaning, by
choice, so that your transcripts are not sent to an outside service to build
it; it covers only chats on the machine the box runs on, and only the text you
and the agent wrote, not tool output or attachments. Searching chats from the
box-wide search is not built. The strip is new (2026-11-12): a
card type supplied by a box is covered only by unit tests, and the iPhone
app's shell around the strip and a presenter driving it with spoken
checkpoints have not been tried.

**Go deeper**

[../reference/cards/chat.md](../reference/cards/chat.md),
[../reference/cards/chat-thread.md](../reference/cards/chat-thread.md) (history only),
[../reference/chat-voice.md](../reference/chat-voice.md),
[../reference/narration-mode.md](../reference/narration-mode.md),
[voice.md](voice.md)
