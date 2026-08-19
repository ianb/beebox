---
title: "The box pre-commit hook costs seconds per commit — three `cb` cold starts plus two box-wide scans"
workstream: commit-performance
design: ../../../callback-box/docs/plans/commit-performance.md
area: callback-box
labels: [performance, validation, boxes]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder saw 6.63s reported for git commit/hooks on a box
resolution: implemented
---

> **Closed 2026-08-19 (commit 4ae22252, cab459dd):** Phase 1 of the linked
> plan fixed the named complaint — the hook's three `cb` invocations collapsed
> into one `cb validate --pre-commit`, the box-wide scans made
> incremental/index-based, and heavy externals made lazy. Measured: small-box
> commit 2.2s → ~0.7s. Remaining ideas (a resident `cb` process, lazy command
> registration, fewer commits per operation) are recorded as Phases 2–3 in
> [the plan doc](../../../callback-box/docs/plans/commit-performance.md),
> deliberately not built pending discussion.

A commit on a large box reported **6.63s** in git + hooks. Measured
2026-08-18, the cost is two separable things, and both are worth fixing
independently.

> **Update 2026-08-19:** full attribution measured on a test1 clone (1,815
> files): git's own commit work + post-commit hook ~0.08s, `git annex
> pre-commit` ~0.11s, and ~2.2s is the three `cb` boots (~0.7s each, ~0.1s of
> real check work each) — commit total 2.3s. The startup floor is bundle eval
> plus eager loading of heavy externals (agent SDK, typescript, sharp) that
> the validate path never uses. Design and fix plan:
> [commit-performance plan](../../../callback-box/docs/plans/commit-performance.md).

## A fixed cost that every box pays

`cb --version` on a small box takes **0.81s** — Node startup plus loading the
bundle, before any work at all.

The managed pre-commit hook invokes `cb` **three times**: `validate --staged`
(when cards are staged), `validate --links`, and `attachments check-unlisted`.
That is ~2.4s of pure process startup on *any* box, including an empty one,
plus `git annex pre-commit` and git's own work.

**This is the larger share on a small box and it is pure overhead.** One
invocation that does all three checks would save ~1.6s per commit everywhere,
with no change to what is checked.

## A growth cost that scales with the box

Two of the three checks are **box-wide scans that ignore what is staged**:

| | small box (1,319 files) | large box (12,774 files) |
|---|---|---|
| `cb --version` (startup floor) | 0.81s | — |
| `cb validate --links` | 1.01s | **2.57s** |
| `cb attachments check-unlisted` | 0.87s | **1.61s** |

Subtracting the startup floor, the actual scanning work goes from ~0.2s on
the small box to ~2.4s on one roughly ten times its size. It scales with the tree, not
with the change — so it gets worse forever. The same box is growing at ~105
files/hour by its own `box-growth` check.

`validate --links` is box-wide for a stated reason, and the reason is sound:
the hook's comment notes that "a move can break links in files that aren't
staged (the referrers), which `--staged` never sees." The scope is right; doing
it synchronously on every commit is the expensive part.

## Directions

- **Collapse the three invocations into one.** Biggest win per unit of effort,
  helps every box, changes no semantics.
- **Make the referrer scan incremental.** Only files that link *to* something
  the commit touched can newly dangle. That is a much smaller set than "every
  file", and it preserves exactly the property the box-wide scan exists for.
- **Or move it off the commit path.** It is already warn-only (`|| true`), so it
  blocks nothing — a post-commit or scheduled check would surface the same
  dangling links without making the developer wait. Worth deciding whether a
  warning nobody can act on synchronously belongs in a pre-commit hook at all.
- **`attachments check-unlisted` does block**, so it cannot simply move — but it
  only needs to consider attach scopes touched by the commit.

## Why this matters beyond impatience

Agents commit constantly — every card mutation, every feedback item, every
scheduled task's output. A six-second commit is a tax on every one of those,
and on a box growing by a hundred files an hour it is a tax that compounds. It
also lands on the interactive path: a chat turn that writes a card waits for
this.
