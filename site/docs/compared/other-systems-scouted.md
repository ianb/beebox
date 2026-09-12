---
description: "One system the maintainers scouted but judged too thin, or not a real alternative, for its own comparison page."
compared:
  date: 2026-07-04
  subject: "Claude Code Channels, Anthropic (research preview, Claude Code v2.1.80+)"
  beebox: "2026-07-04"
  looked-for: [what it is, how it relates to Bee Box's own chat surface]
  not-looked-for: [pricing, hosted offerings, community size, a full architecture comparison]
---
# Other systems scouted

This page covers a system the maintainers looked into briefly, where the
research did not go deep enough to justify its own comparison page. It is
included for completeness, not as a full comparison.

## Claude Code Channels

Claude Code Channels is a research-preview feature of Claude Code itself, the
same coding agent Bee Box runs on, not a competing personal-assistant system.
It lets a small program (an MCP server) push live events, such as a Telegram
or Discord message, into a running Claude Code session, and lets the person
on the other end approve or deny a tool request from inside that chat.

As of this comparison, Bee Box's own **box** (one directory, also a git
repository, holding **cards**: files with YAML frontmatter and a markdown
body) has no channel-style chat ingress built on this feature. Bee Box's
one real two-way chat surface, its Telegram connector, predates Channels and
does not use it. The two ideas are close in one respect: Channels' way of
asking a person to approve a tool call from inside a chat message is the same
shape as a Bee Box question card, a pending decision waiting for an answer.
Where they differ is scope: a Channels event only arrives while a Claude Code
session is open, so using it for always-on chat ingress would mean deciding
whether incoming messages become cards immediately or only while a session
happens to be running, a design question Bee Box had not resolved as of this
comparison.

**What this comparison did not look at:** pricing, hosted offerings,
community size, or a full architecture comparison, since Channels is a
platform feature rather than a system to compare against.
