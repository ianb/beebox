---
description: "What Bee Box is: a self-hosted assistant a coding agent operates over a directory of markdown cards; how things get in (voice, phone, browser, Telegram, email sync), what comes out, and what the agent builds inside it."
---
# What Bee Box is

Bee Box is a personal assistant system that runs on a computer you control. A
coding agent operates it. The supported agents today are Claude Code
(Anthropic) and Codex (OpenAI). You feed the system inputs: voice memos,
emails, photographs, web clippings, chat messages. The agent turns those
inputs into **cards**, takes the actions it understands, and asks you a
question when it does not understand.

A **box** is the data: one directory on disk, kept under version control with
git. It holds the cards, the configuration, and the state. A **card** is a
single file: a structured header that the system checks against the card's
type, plus optional text (the type is part of the filename, for the curious). The files on disk are the
state of the system. Git is the history, so every change the agent makes is a
commit you can read. The web interface and chat are built over a box; there is
also a command you can type directly (**`bbx`**), for the technically
inclined.

The engine and the box are separate. The engine is the software the project
publishes; the box is your data. You can update the engine without touching
the box.

**How things get in.** More ways than a chat box:

- Chat in the web interface, typed or spoken, with the reply read aloud if you want.
- An iPhone app, and a capture page that works in any phone browser: voice memos, photos, scans of paper, dictation.
- A browser extension that saves the page you are reading, with your remarks.
- Telegram, so a group chat can be the way a household talks to it.
- Connectors that sync Gmail threads, Google Calendar, and Google Drive files into cards.
- Files you drop in as a batch, and anything you type at the command line.

**What comes out.** A place that accumulates. Email threads you asked it to
watch become cards. A voice memo becomes a transcript and then a todo or a
record. Scanned paper becomes records you can search. Corrections you make
become rules the agent reads next time. It asks a question when it is unsure
and waits for your answer.

**It builds inside the box.** The agent has real tools, so it can make things
that persist: a view that renders a kind of card the way you want it, a
dashboard, a small program for a task that repeats, a procedure that runs on
a schedule, a new kind of card with its own fields and instructions, a page
published from your cards. What it builds is a file in the box, versioned
like everything else. See [what you can use it for](02-what-you-can-use-it-for.md)
and [making it yours](13-making-it-yours.md).

Bee Box is early, source-available under GPLv3, self-hosted, and built by one
maintainer. Running it requires a machine that stays on and your own Claude
Code or Codex login. For Claude, that means signing in with a Claude
subscription; the documentation is explicit that an API key alone will not
work, by design.

Next: [who it is for](04-who-it-is-for.md), [what it requires](08-what-it-requires.md),
and [the glossary](concepts/glossary.md).
