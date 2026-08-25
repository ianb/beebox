---
title: "Chat review stops advancing once a transcript passes MAX_SESSION_ENTRIES"
workstream: chat-history-scale
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — Track A of docs/plans/chat-history-oom-mobile-lock.md
priority: normal
---

`parseSessionLog` no longer retains a whole transcript (that OOM'd `cb serve`
in prod on 2026-08-01). Every caller now names a bounded slice, capped at
`MAX_SESSION_ENTRIES` (5 000) — `callback-box/src/cli/lib/session-retention.ts`.

Chat review is the one consumer that genuinely wanted the whole file. Its span
resolution (`core/chat/review/span.ts`) hashes every entry *before* the journal
boundary, so it must read from the top. It used to pass
`limit: Number.MAX_SAFE_INTEGER` with an invariant that nothing was paged. It now
reads the first 5 000 entries.

## What is still broken

A session that passes 5 000 entries stops being reviewed, permanently. Its
journal boundary is below the read window, so the run cannot locate an unread
span. The session's husk title, `contains`, and account never change again.

The standstill is loud, not silent. `discoverSessions` counts the session in
`boundaryBeyondWindow` and `console.warn`s its id; `cb chat review status` and
`cb chat review run` both print the count. But nothing advances it.

Options, unsettled:

- A streaming span resolver: fold the prefix hash as the scan advances, and
  retain only the entries after the boundary (bounded by the same ceiling).
  Probably the right answer — it makes review O(window) in memory whatever the
  transcript length.
- Persist a rolling prefix hash in the journal, so a re-read does not have to
  re-hash the prefix at all.
- Accept the cap and say so in `docs/chat-review.md`.

## What was fixed (post-review, 2026-08-01)

The truncated read also made `resolveSpan` report `boundary-missing`, so the run
bootstrapped from the truncated first page. That re-summarized thousands of
already-folded entries, and then recorded a span whose `endIndex` sat *behind*
the real boundary — a journal regression that destroyed the reviewed position.

`resolveSpan` now takes a `truncated` flag. A boundary absent from a truncated
read returns `deferred: "boundary-beyond-window"`, and both discovery and the run
leave the husk and the journal untouched. Bootstrapping stays legal only when the
read reached the top of what exists, or when there is no prior applied span.
Pinned by `test/core/chat/review/{span,discovery,run}.doctest.md`.

## Fixed (2026-08-25)

Took the first option. `resolveSpan` (`core/chat/review/span.ts`) now walks the
transcript in pages through a `SpanPageReader`, folding the prefix hash
incrementally (byte-identical to the whole-array `prefixHash`, so existing
journals still verify), retaining nothing before the boundary and at most
`limit` (= `MAX_SESSION_ENTRIES`) entries after it. A longer backlog is
reviewed across consecutive runs (`clipped`); a bootstrap is bounded the same
way. `deferred`/`boundaryBeyondWindow` are gone — the boundary is always
findable if it exists. Pinned by `test/core/chat/review/{span,discovery,run}.doctest.md`.
