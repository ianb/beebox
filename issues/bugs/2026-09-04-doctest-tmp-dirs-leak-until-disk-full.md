---
title: "Doctest tmp box dirs leak; ~10k orphans filled the disk to 0 bytes free"
workstream: unattached
area: beebox
labels: [testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-layout-criteria — Track B/C implementation hit a machine-wide disk-full mid-run, 2026-09-04
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
[chat-default-route tmpdir cleanup race](../closed/bugs/2026-08-08-chat-default-route-tmpdir-cleanup-race.md)
(a different failure — cleanup racing itself, not leaking).
