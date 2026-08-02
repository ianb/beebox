---
title: "Monotonic JSONL stores (retro ledger, usage manifest) read whole with no rotation"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
---

Two append-forever JSONL stores are read whole into memory and never rotated:

- **Retro ledger** — `loadLedgerEntries`
  (`callback-box/src/core/retro/ledger.ts`) reads the whole file into a
  string, splits, and retains every entry; `loadEvidenceHashes` amplifies it.
  Grows one line per observation per nightly run, forever. Batch path. The
  consumer (`retro/scan.ts`) only needs the `evidenceHash` Set — stream lines
  and keep just that.
- **Usage manifest** — `readManifest` (`callback-box/src/core/usage.ts`), one
  line per session ever run, read whole and held as a Map for `cb usage`.
  CLI. Stream it, or prune entries older than the retention window.

(The scheduler log has the same read shape in
`cli/commands/scheduler-helpers.ts` but is already rotated at 1 MB — fine.)

Not urgent (small lines, slow growth), but the pattern is the same
bounded-nothing shape that produced the 2026-08-01 OOM; worth sweeping when
touching either subsystem.
