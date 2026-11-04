---
title: "Concurrent Docling PDF conversions push a box past its memory limit and stall the whole box"
workstream: docling-memory
area: beebox
labels: [pdf, docling, memory, prod]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — hosted box reported down, 2026-11-03"
resolution: implemented
---

**Closed (implemented, 2026-11-03):** Landed on branch worktree-docling-memory (memory-bounded driver c09eb0eb7, one conversion at a time, MemoryHigh=2G/MemoryMax=2560M/OOMPolicy=continue); RapidOCR spike and uv warning filed separately.

On 2026-11-03 a hosted box looked down from the iOS app. `bbx serve` was
running, but requests timed out or returned 500 ("Could not acquire the
mobile device-store lock ... within the retry budget"), and a chat warm-up
failed ("Subprocess initialization did not complete within 60000ms").

Cause, read on prod: the box's cgroup sat at its `MemoryHigh` (1 GiB, the same
for every box) with memory pressure `full avg300=97%`. About 1.14 GB was
resident and 3.85 GB swapped out, which filled the host's 4 GB swap. Two
`docling convert` runs, started about 33 minutes earlier by the chat's
background research (`services/docling/core.ts` arguments: `--to md --to json
--image-export-mode referenced --table-mode fast`), used about 400 MB and
195 MB resident. With the box server (about 275 MB) and the chat's Claude
process (about 267 MB), that put the cgroup over its limit, and the kernel
throttled every process in it.

The boxholder raised that box's `MemoryHigh` to 2G at runtime
(`systemctl set-property --runtime`), and pressure fell to under 10% within a
minute. That box's runtime setting is to be put back later; it also lapses on
a service restart or reboot.

Fix directions:

- Run one Docling conversion at a time per box: a per-box queue or lock in
  `services/docling/core.ts` (the single caller of `uvx docling`). A wait is
  much cheaper than a stalled box.
- Run each conversion in its own memory-limited transient unit or cgroup
  (for example `systemd-run --scope -p MemoryMax=...`, the way
  `bbx-codex-sandbox-install` checks run under the box's sandbox properties),
  so a large PDF fails alone instead of stalling the box server and chat.
- Consider a host-wide limit too: one box's conversions filled the host swap
  that every box shares.
- Report a conversion that fails or is killed for memory to the caller with a
  clear reason, so the agent retries later or splits the PDF instead of
  retrying in parallel.

Related: [large box mode](../../features/2026-11-01-large-box-mode.md) (the same
box's earlier heap OOMs) and
[maintenance closes chats with live background tasks](2026-11-02-maintenance-quiesce-ends-chats-with-live-background-tasks.md)
(the same long research runs).

## Findings and fix (docling-memory workstream, 2026-11-03)

Measured in a Linux cgroup (D18 in
`beebox/docs/plans/scanner-ingest-docling-decisions.md` has the method and
every number). One conversion with the old CLI argv did not fit a 1 GiB box on
its own: 1.4 GB peak on a 9-page PDF, 2.3 GB on a 56-page report, and an OOM
kill at 3.5 GB on a 333-page manual. The prod RSS figures above were low
because most of each process had been swapped out.

The fix, on branch `worktree-docling-memory`:

- A Python driver replaces the `docling convert` call. It keeps page images
  out of the pipeline and uses batches of one, then renders pages and figures
  one at a time. Peak is about 1.0-1.1 GB for any digital PDF measured
  (333 pages included), 1.56 GB for a 16-page scan with OCR. Output is
  byte-identical to the CLI's.
- One conversion at a time per box and per host: kernel locks held by the
  driver for its whole run, released when it exits; the driver stops if its
  `bbx` parent dies.
- Failure reasons on the card for a lock wait over 20 minutes and for an
  out-of-memory kill (from the cgroup's `oom_kill` counter).
- Agent subprocesses now inherit `UV_CACHE_DIR` and `HF_HOME`. Before this,
  conversions started by the chat built a private uv environment and model
  cache under the box's home (6.4 GB and 506 MB on this box), while the
  host's shared caches stayed empty.
- Box units: `MemoryHigh=2G` (boxholder decision), proposed with it
  `MemoryMax=2560M` and `OOMPolicy=continue`. With `OOMPolicy=stop`, the
  current setting, an OOM kill of Docling stops the whole box unit.

Not done here: a host-wide memory limit across boxes; removing the per-box
caches already on prod; the OCR detector spike
(`2026-11-03-rapidocr-detector-memory-spike-on-scans.md`).
