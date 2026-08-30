---
title: "Monotonic JSONL stores (retro ledger, usage manifest) read whole with no rotation"
workstream: chat-history-scale
area: beebox
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
resolution: implemented
---

**Closed 2026-08-25** — resolved by commits f7d24973 / b093062b (workstream chat-history-scale). See the "Fixed (2026-08-25)" section below for what shipped.

Two append-forever JSONL stores are read whole into memory and never rotated:

- **Retro ledger** — `loadLedgerEntries`
  (`beebox/src/core/retro/ledger.ts`) reads the whole file into a
  string, splits, and retains every entry; `loadEvidenceHashes` amplifies it.
  Grows one line per observation per nightly run, forever. Batch path. The
  consumer (`retro/scan.ts`) only needs the `evidenceHash` Set — stream lines
  and keep just that.
- **Usage manifest** — `readManifest` (`beebox/src/core/usage.ts`), one
  line per session ever run, read whole and held as a Map for `bbx usage`.
  CLI. Stream it, or prune entries older than the retention window.

(The scheduler log has the same read shape in
`cli/commands/scheduler-helpers.ts` but is already rotated at 1 MB — fine.)

Not urgent (small lines, slow growth), but the pattern is the same
bounded-nothing shape that produced the 2026-08-01 OOM; worth sweeping when
touching either subsystem.

## Fixed (2026-08-25)

Both stores are read line by line over a stream instead of whole-file + split.

- `beebox/src/core/retro/ledger.ts` — `loadLedgerEntries` and
  `loadEvidenceHashes` share a `forEachLedgerEntry` streaming walk;
  `loadEvidenceHashes` adds to its Set as lines go past, so it never
  materializes the entries. `loadLedgerEntries` stays — `retro-scan.doctest.md`
  and the integrator still read full entries. Covered by
  `beebox/test/core/retro/ledger.doctest.md`.
- `beebox/src/core/usage.ts` — `readManifest` became async and streams;
  its one caller (`syncUsage`) awaits it.

Rotation/pruning was not added — the streaming read is the cheap half, and
neither store has a retention policy to hang a prune on yet.
