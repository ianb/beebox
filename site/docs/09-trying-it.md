---
description: "How to install Bee Box: the container path, the from-source path, the agent-driven install, and what the first hour looks like."
---
# Trying it

There is no hosted trial. You install Bee Box on a machine you control, then
create a **box**: your own directory, kept under version control with git,
holding the cards the system works with.

**The container path is the primary one.** Docker with Compose v2 plus a
clone of the repository, since no image is published yet. The sequence is
four steps: `bbx init` to create the box in a directory you choose,
`claude auth login` to authenticate the coding agent, `docker compose up -d`,
then open the printed local URL. By default the box listens only on your own
machine, so nothing else on your network can reach it until you decide
otherwise.
Details: [install/docker.md](install/docker.md). That guide documents the
Claude login; the documentation does not describe logging Codex in inside
the container.

**The from-source path is for modifying the engine.** It needs Node 24,
pnpm, and several system binaries, and it ends with a `doctor` command that
checks every prerequisite and prints a remedy for anything missing.
Details: [dev/developer-install.md](dev/developer-install.md).

**The agent-driven install.** The project publishes an install guide written
for your own coding agent, so you can ask Claude Code or Codex to do the
install with you: [install/agent-install.md](install/agent-install.md). That
guide tells the agent to treat the instructions as advice rather than
authority, and to ask you before anything that affects your machine, your
data, or your accounts. Four decisions are yours: run it or hack on it,
where the box lives, your own agent login, and whether the box is exposed
beyond loopback.

**The first hour.** Start with the inputs that need no external account:
type into chat, record a voice memo, photograph things and talk about them.
Scheduled processing is off on a fresh box, so nothing runs on its own until
you turn it on. Connecting Google, which unlocks Gmail and Calendar, is the
slower step; the documentation suggests leaving it for later.

**Updating** means fetching the latest version of the project and rebuilding. On start, the
container migrates the box's card data and refreshes its generated agent
docs. See [status and maturity](11-status-and-maturity.md), which also notes
what the update story does not yet cover.
