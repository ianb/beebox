---
title: "Email storage: API access for the bulk, file-based cards only for threads that earn it"
area: callback-box
filed-by: agent
discovered-in: ios-capture-upload-diag worktree — raised by the boxholder after the box-family watcher OOM, 2026-08-05
---

> **Job to be done:** *I want my assistant to be able to reach any of my email
> when it needs to — without my box having to physically contain all of it.*

**Boxholder's position (2026-08-05), to be designed against:** most email should
be reached through **API access**, with only a limited set of threads
materialized as file-based cards in the box — *"especially history."* The
backlog is the part that least deserves to be mirrored: it is large, mostly
noise, and almost never read again, yet it is exactly what a file-based sync
imports first.

This is a decision item, not a bug: it changes what a box *is* for a
high-volume connector, and the same question applies to any source with more
history than a box should hold.

## Why it's live now

box-family's email sync produced **68,869 directories**, which
[OOM'd the server through the file watcher](../bugs/2026-08-05-box-watcher-unbounded-scale-oom.md)
and prompted
[volume limiters for the connector](../bugs/2026-08-05-email-connector-needs-volume-limiters.md).
Limiters bound the damage; this item asks whether the file-based default is
right at all for mail.

## What a design needs to answer

- **The reach mechanism.** How an agent queries mail it doesn't have locally
  (a tool/connector call at agent-time?), and how that composes with the box's
  offline/filesystem-is-state model — the point where this stops being a
  connector tweak and becomes an architecture question.
- **The promotion rule.** What causes a thread to *become* a card: the user
  says so, the agent decides it's referenced by real work, a reply is drafted,
  a label matches. And whether promotion is reversible (demote back to
  API-only, leaving a stub).
- **What a non-materialized thread looks like to the box.** Nothing at all, or
  a lightweight pointer card that's cheap in file count but keeps mail
  addressable/searchable and lets landmarks/links resolve.
- **History and search.** Whether search spans API-only mail, and what the
  agent is told about the boundary — an agent that believes the box contains
  all mail will answer wrongly about what it can't see (a
  [cb-context](../../callback-box/CLAUDE.md) concern as much as a code one).
- **Generality.** Whether this becomes a connector-wide pattern
  (materialize-on-demand with a promotion rule) rather than an email special
  case — chat logs, calendars, and drive files have the same shape.
