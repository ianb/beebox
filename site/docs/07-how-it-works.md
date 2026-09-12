---
description: "The mechanism: a box is a directory, cards are markdown, git is the history, and an agent processes job cards."
---
# How it works

**A box is a directory.** One directory on disk is a box, kept under version
control with git (for the curious, it is also structured as a self-contained
software package, marked by a hidden `.beebox/` folder). Everything lives in
that directory; there is no separate database. The top level is organized
into a few fixed areas, such as your content, settings, and internal
bookkeeping (for the curious, these are named with a leading underscore:
`_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `_tmp/`). Below the
content area, you and the agent (the coding agent operating the box) create
whatever directories you want.

**Cards are files with a structured header.** A **card** is a file named
`Title.type.card`. The type segment in the filename tells the system which
set of fields to check it against. The file starts with a structured header
and, for card types that allow it, some text below: markdown with a small
baseline of marks any card can use, a quote, a source, a todo (see
[enriched markdown](concepts/enriched-markdown.md)). Attachments live
alongside it in a matching folder. Cards are checked when they're created and
checked again automatically before every change is saved. See
[concepts/cards.md](concepts/cards.md).

**Git is the history.** Every change the agent makes is a commit, so you can
trace why something moved. The agent reads that history too.

**Engine and box are separate.** The engine is the project's software,
installed directly or run in an isolated container. The box is your data and
can be updated or moved independently.

**The agent runs with real capabilities.** The agent that runs inside a box
has full permissions: no list of allowed actions restricts what it can do. It
can run any command on the machine and read or write any file in the box.
Read [security/overview.md](security/overview.md) before deciding.

**The wakeup cycle.** A **wakeup** is one pass: preprocess inbox items, run
housekeeping and any scheduled tasks, sync connected services, create a job
for each new item, have the agent work through those jobs, then save the
changes to your remote copy of the git history if you set one up. Between
passes the engine is idle; it does not check continuously.

**The agent's own tool.** Underneath the web interface and chat is a command
called `bbx` that the agent uses, and that you will rarely see. It is how the
engine guides the agent: creating a card from a template with the right
fields, checking a card before it is saved, running a sync or a procedure,
asking a question the right way. Everything the agent does is one of those
commands or a direct file edit, so its work is inspectable and repeatable.
The commands are listed in [reference/bbx-commands.md](reference/bbx-commands.md)
for the technically inclined.

Why it is built this way: [design/identity.md](design/identity.md), the rest
of [design/index.md](design/index.md), and the narrative in
[architecture/01-what-is-this.md](architecture/01-what-is-this.md). Internals:
[reference/index.md](reference/index.md).
