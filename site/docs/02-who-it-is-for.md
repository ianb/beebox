---
description: "Who Bee Box fits, who it does not, and the requirements that end an evaluation early."
---
# Who it is for

Bee Box is a self-hosted personal assistant operated by a coding agent
(Claude Code or Codex). A **box** is your data: one directory, also a git
repository, holding **cards**, which are markdown files with validated YAML
frontmatter. Terms are defined in [the glossary](concepts/glossary.md).

## It fits you if

- You already run Claude Code or Codex, or are willing to.
- You have a computer that stays on: a Mac or Linux machine at home, or a
  small VPS. The documentation says a $5/month VPS is enough for the
  container path.
- You are comfortable with files, git, and a command line during setup and
  repair, even though daily use happens in a web interface and chat.
- You want an assistant whose memory is plain files you own, that accumulates
  records over months, and that you can read, correct, and version.
- You are willing to run an agent that has real filesystem and shell access
  to the box.

## It does not fit you if

- You want an app you install and sign into. There is no hosted service and
  no published container image; you build from the repository.
- You want to use it from a phone only. There are phone surfaces, including
  capture pages, a web app, Telegram, and an iOS app built locally, but the
  box itself runs on a computer you keep running.
- You want a finished chat product. Bee Box is early, changing fast, and
  maintained by one person.
- You need vendor independence. The documentation names Claude Code and
  Codex as the supported engines and describes no local-model option.

## Households

A box can hold several people. The design states that boxes are shared, with
one granularity: everyone in a box shares everything in it. Different groups
need different boxes. Per-member identity beyond the login allowlist is not
designed yet. The narrative in
[architecture/01-what-is-this.md](architecture/01-what-is-this.md) shows a
household using one box through a group chat.

Details of the requirements are in [what it requires](06-what-it-requires.md).
