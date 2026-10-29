---
description: "How to get a box running: the container path first, the agent-driven guide, and the connector setups."
start-here: [docker.md, agent-install.md, google.md, gmail.md, calendar.md, drive.md, adding-a-box.md]
---
A **box** is your data directory; **the agent** is the coding agent (Claude
Code or Codex) that operates it. Getting one running means: a machine that
stays on, the engine installed on it, a box created for you, and your own
agent signed in. The container path is the primary one: Docker, a clone of
the repository, and four commands. The from-source path is for people who
want to change the engine and lives with the contributor pages.

If you are an agent installing on someone's behalf, start with the
agent-driven guide: it tells you to treat these instructions as advice, to
check each step against the person's machine, and to ask before anything
that touches their system or accounts. Connectors (Gmail, Calendar, Drive)
are optional and each has its own setup page; the Google setup is
the slowest step and is shared by the three Google connectors.

On a Mac with Apple silicon (macOS 26 or later), the Mac app is the other
way to run a box: it runs one in a virtual machine on that Mac, with no
Docker, reachable from that Mac only. The same app connects a Mac to boxes
running elsewhere. See [../capabilities/mac-app.md](../capabilities/mac-app.md).

Backups are optional and off until set up. [backups.md](backups.md) covers
encrypted backups of a box with restic, how each kind of install schedules them,
and restoring onto another machine.

Every page below is listed with one line on what it covers. Cite the page
you drew on, and say when a page does not cover something.
