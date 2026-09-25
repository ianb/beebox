---
title: "Doctest tmp box dirs leak; ~10k orphans filled the disk to 0 bytes free"
workstream: unattached
area: beebox
labels: [testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-layout-criteria — Track B/C implementation hit a machine-wide disk-full mid-run, 2026-09-04
priority: important
resolution: implemented
---

During a normal implementation session the machine hit 0 bytes free. The
cause was ~10k orphaned doctest temporary box directories under the macOS
per-user temp root (`$TMPDIR`, i.e. `/var/folders/…/T/`). Clearing entries
older than 30 minutes freed ~6 GiB and unblocked the run.

Doctests create tmp boxes (`makeTmpBox`, `fs.mkdtemp(bbx-…)`) and register
cleanup blocks, but a killed run, a crashed worker, or an assertion path
that skips teardown leaves the directory behind. Nothing ever sweeps them:
macOS clears these dirs only on reboot/period cleanup, and heavy agent use
runs the suite far faster than that.

Fix directions (undecided):

- A sweep at suite start (tap setup): delete `bbx-*` tmp dirs older than
  some age. Cheap, bounded, catches every leak source.
- Harden per-test teardown (`t.teardown` already runs on failure — the leak
  is process-kill shaped, so this can reduce but not eliminate).
- Both. The suite-start sweep is the honest backstop; an age threshold
  (e.g. 1h) avoids racing parallel runs.

Related closed item:
[chat-default-route tmpdir cleanup race](2026-08-08-chat-default-route-tmpdir-cleanup-race.md)
(a different failure — cleanup racing itself, not leaking).


## Fixed 2026-09-12 — suite-start sweep

Took the first fix direction (a sweep) rather than the second (harden
teardown), because the issue's own diagnosis rules the second out on its own:
the leak is process-KILL shaped, and a killed process runs no teardown.

`test/helpers/isolate-user-home.ts` — already the preload that owns temp
hygiene — now sweeps `bbx-doctest-*` and `bbx-test-home-*` entries from the
temp root. Three guards keep it from being worse than the leak:

- **Age floor, 2h.** A directory belonging to this run, or to a suite running
  in parallel in another worktree, is never touched. This is the issue's own
  suggested threshold.
- **Stamp gate, 10 min.** The module preloads into every test process and a
  suite is hundreds of them; a shared stamp file in the temp root means the
  scan happens at most once per interval, claimed before scanning so parallel
  starters do not all scan at once.
- **Work cap, 2000 removals.** A large backlog drains over several runs instead
  of stalling one startup. It also never runs under `BBX_TEST_REAL_HOME=1`.

Every failure is swallowed: a test run must not fail because housekeeping could
not delete a directory.

**Scale when fixed.** The issue reported ~10k orphans filling the disk. On
2026-09-12 the temp root held **519,712** `bbx-*` entries, 514,972 older than
two hours — about 2.7 GB, but the real cost was half a million inodes making
the directory slow to enumerate at all.

Verified directly rather than by reading: an old `bbx-doctest-*` and an old
`bbx-test-home-*` are removed; a FRESH `bbx-doctest-*` survives the age floor;
an old `unrelated-*` survives the prefix filter; and a second run inside the
interval leaves an old directory alone, proving the stamp gate holds.

One stale comment fixed alongside: the exit handler claimed a HOME held open by
a child "is deleted by the next run's sweep" — no sweep existed when that was
written.
