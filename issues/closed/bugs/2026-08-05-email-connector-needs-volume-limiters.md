---
title: "The email connector has no volume limiters — a normal inbox lands ~69k directories in the box"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: ios-capture-upload-diag worktree — box-family, 2026-08-05
resolution: implemented
---

Resolved by `ba3bf436`, with review hardening in `30f1e6e3`. Gmail now
defaults to creating no cards, treats live thread cards as a bounded working
set, supports explicit tracking and named automatic rules with rolling caps,
and exposes excess matches through bounded gitignored summaries. The existing
per-message storage shape remains for tracked threads; changing that shape is
separate from the forward volume fix. No existing real-box backlog was removed.

> **Job to be done:** *I want the handful of emails that actually matter to live
> in my box as real cards. I do not want my box to become a mirror of an inbox
> that is mostly noise.*

box-family's `box/` tree is **68,869 directories** — essentially all of it email
the connector synced. That is the direct cause of
[the watcher OOM](2026-08-05-box-watcher-unbounded-scale-oom.md), and it is a
problem in its own right: it dominates the box's file count, its git history,
every whole-tree scan, and the agent's view of what the box contains.

**The boxholder's framing (2026-08-05):** the current file-based email setup
"makes sense for a small number of important emails, but a typical email inbox
gets a shitload of shit, and has a huge backlog." The design is right for the
curated case and wrong for the default case, and nothing currently stops the
default case from happening.

## What's missing

The connector syncs without any of the limiters a high-volume source needs:

- **A backlog bound.** Nothing caps how far back an initial sync reaches, so
  adopting a box means importing an inbox's entire history.
- **A per-sync volume cap** with a visible "N more not imported" signal, rather
  than importing whatever arrived.
- **Selectivity.** No notion of which mail is worth a card — the interesting
  design question is whether that's label/folder-scoped, sender-scoped,
  explicitly-promoted, or agent-triaged, and whether the default should be
  *import nothing until told*.
- **A storage shape that doesn't cost a directory per message.** Each thread
  gets an attach directory and each message a subdirectory; that's what turns
  volume into a watcher/scan problem. A thread could be one card with inline
  messages, with attachments only for mail that actually has them.

Related but distinct: whether most email should stay in the provider and be
reached via API instead of being mirrored into the box at all —
[email storage: API access vs file-based threads](../decisions/2026-08-05-email-storage-api-vs-file-based.md).

## Note on scope

Limiters here are the *forward* fix. Boxes already carrying a synced backlog
need separate cleanup, which for a specific box is that box's own operational
task, not this item.
