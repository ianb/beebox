---
description: "What Bee Box is: a self-hosted personal assistant that a coding agent operates over a directory of markdown files."
---
# What Bee Box is

Bee Box is a personal assistant system that runs on a computer you control. A
coding agent operates it. The supported agents today are Claude Code
(Anthropic) and Codex (OpenAI). You feed the system inputs: voice memos,
emails, photographs, web clippings, chat messages. The agent turns those
inputs into **cards**, takes the actions it understands, and asks you a
question when it does not understand.

A **box** is the data: one directory on disk, which is also a git repository.
It holds the cards, the configuration, and the state. A **card** is a single
file, named `Title.type.card`, containing YAML frontmatter validated against a
schema plus an optional markdown body. The filesystem is the state of the
system. Git is the history, so every change the agent makes is a commit you
can read. **`bbx`** is the command-line program that operates a box, and the
web interface and chat are built over the same box.

The engine and the box are separate. The engine is the software from the
project's repository; the box is your data. You can update the engine without
touching the box.

What you get back is a place that accumulates. Email threads you asked it to
watch become cards. A voice memo becomes a transcript and then a todo or a
record. Corrections you make become rules the agent reads next time. The web
interface shows the box, and the agent can generate pages and views over your
own cards.

Bee Box is early, source-available under GPLv3, self-hosted, and built by one
maintainer. Running it requires a machine that stays on and a Claude Code or
Codex login of your own. For Claude the documentation requires a Claude
subscription login; it says `ANTHROPIC_API_KEY` is ignored by design.

Next: [who it is for](02-who-it-is-for.md), [what it requires](06-what-it-requires.md),
and [the glossary](concepts/glossary.md).
