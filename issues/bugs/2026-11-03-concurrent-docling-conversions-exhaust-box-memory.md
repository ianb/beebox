---
title: "Concurrent Docling PDF conversions push a box past its memory limit and stall the whole box"
workstream: docling-memory
area: beebox
labels: [pdf, docling, memory, prod]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — hosted box reported down, 2026-11-03"
---

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

Related: [large box mode](../features/2026-11-01-large-box-mode.md) (the same
box's earlier heap OOMs) and
[maintenance closes chats with live background tasks](2026-11-02-maintenance-quiesce-ends-chats-with-live-background-tasks.md)
(the same long research runs).
