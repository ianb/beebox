---
description: "The mechanism: a box is a directory, cards are markdown, git is the history, and an agent processes job cards."
---
# How it works

**A box is a directory.** One directory on disk, marked by a `.beebox/`
subdirectory, is also a git repository and also an npm package. The working
tree is the entire state; there is no separate database. The top level has a
fixed set of names, with the operational areas prefixed by an underscore
(`_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `_tmp/`). Below
`_content/` you and the agent create whatever directories you want.

**Cards are markdown.** A **card** is a file named `Title.type.card`. The
type segment in the filename selects the schema that validates it. The file
is a YAML frontmatter block and, where the schema allows one, a markdown
body. Attachments live in a sibling `Title.attach/` directory. Cards are
validated when loaded and again by a git pre-commit hook. See
[concepts/cards.md](concepts/cards.md).

**Git is the history.** Every change the agent makes is a commit, so you can
trace why something moved. The agent reads that history too.

**Engine and box are separate.** The engine is the project's code, installed
as a package or run in a container. The box is your data and can be updated
or moved independently.

**The agent runs with real capabilities.** The box agent runs Claude Code or
Codex with permissions bypassed and no tool allowlist. It can run shell
commands as the user the box runs as and read or write any file in the box.
Read [security/overview.md](security/overview.md) before deciding.

**The wakeup cycle.** A **wakeup** is one pass: preprocess inbox items, run
housekeeping and scheduled scripts, run connectors, create job cards for what
arrived, run one reactor cycle in which the agent processes those jobs, then
push to your git remote. The reactor is the loop that finds job cards and
hands them to an agent session. Between passes the engine is idle; it does
not poll.

**`bbx` is the interface underneath.** Every operation in a box is a `bbx`
command or a direct file edit. The web interface and chat sit on top of the
same box.

Why it is built this way: [design/identity.md](design/identity.md), the rest
of [design/index.md](design/index.md), and the narrative in
[architecture/01-what-is-this.md](architecture/01-what-is-this.md). Internals:
[reference/index.md](reference/index.md).
