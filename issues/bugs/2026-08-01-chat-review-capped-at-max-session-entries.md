---
title: "Chat review stops advancing once a transcript passes MAX_SESSION_ENTRIES"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — Track A of docs/plans/chat-history-oom-mobile-lock.md
---

`parseSessionLog` no longer retains a whole transcript (that OOM'd `cb serve`
in prod on 2026-08-01); every caller now names a bounded slice, capped at
`MAX_SESSION_ENTRIES` (5 000) — `callback-box/src/cli/lib/session-retention.ts`.

Chat review is the one consumer that genuinely wanted the whole file. Its span
resolution (`core/chat/review/span.ts`) hashes every entry *before* the journal
boundary, so it has to read from the top, and it used to pass
`limit: Number.MAX_SAFE_INTEGER` with an invariant that nothing was paged.
It now reads the first 5 000 entries and `console.warn`s when a transcript is
longer. Consequence: once a session passes 5 000 entries, its unread span stops
growing, so the nightly reviewer effectively stops updating that session's
husk (loudly, in the log, but it stops).

Options, unsettled:

- A streaming span resolver: fold the prefix hash as the scan advances and
  retain only the entries after the boundary (bounded by the same ceiling).
  Probably the right answer — it makes review O(window) in memory regardless
  of transcript length.
- Persist a rolling prefix hash in the journal so a re-read doesn't have to
  re-hash the prefix at all.
- Accept the cap and say so in `docs/chat-review.md`.

Not fixed inline with the OOM work: bounding the read was the incident fix, and
redesigning span resolution is its own change with its own test surface.
