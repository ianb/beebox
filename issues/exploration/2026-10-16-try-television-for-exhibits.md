---
title: "Try Television as the place agents show work, in place of (or beside) exhibits"
workstream: unattached
area: dev-tooling
labels: [exhibits, dev-process]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-16
---

The boxholder (2026-10-16): "we should try Television instead of exhibits, at
least for a test sometime."

[Television](https://television.run/) is a GUI for personal AI agents.
From its site (not tried here):

- An agent "pins" artifacts (cards, interactive views, web pages) instead of
  leaving them in chat.
- Artifacts are organized into persistent channels.
- It ships reusable skills (Calendar, Tasks, Table).
- A native Mac app (Apple Silicon, macOS 12+) or the browser.
- Works with any agent that can run commands and write files; Claude Code is
  named.
- The site does not say where artifacts are stored, whether it can be
  self-hosted, or what it costs.

## Why it is a candidate

Exhibits (`workstreams-app/docs/exhibits.md`, `bin/exhibits`) are how a
workstream shows work: a page in a per-workstream store, served by the dev
router, with document comments for feedback. The exhibits-rethink workstream
(merged; plan `exhibit-html-controls`) started from "feedback loop doesn't
work, exhibits get buried in discussion and missed". Television's channels are
a different answer to the same problem: a standing place to look, organized
by topic instead of by workstream.

## A test, when someone picks this up

- Install it, connect one workstream's agent, and have it pin the exhibit it
  would otherwise make. Compare finding it, reading it, and replying to it.
- Check where pinned content goes. Exhibits often hold screenshots of test
  boxes, and private box content must not leave the machine.
- Check whether feedback flows back to the agent, which is the part exhibits
  do worst.

Not a decision to replace exhibits.

Re-reviewed 2026-10-30: no trial yet. Television skills (television, tv-table, tv-tasks, tv-calendar) are now available to agent sessions on this machine, so the install step may already be done.
