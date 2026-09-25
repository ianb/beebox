---
title: "Box growth counts files and directories but never bytes, and skips .beebox"
workstream: connector-silence
area: beebox
filed-by: agent
discovered-in: worktree-connector-silence — part 3 of the box-growth issue, deferred when its level warnings were removed
resolution: implemented
---

> **Closed** — `03e8b7e59` measures disk use of content and `.beebox`
> separately via `du -sk`; `8f4019e61` reports when a measurement was skipped.
> The new byte-rate threshold (100 MB/hour) is an agent-chosen value, not
> boxholder-set. See `beebox/docs/implemented-plans/connector-silence.md`.

The growth check measures file, directory and commit counts and Git object
bytes. It never measures content bytes, and the scan prunes `.beebox`
(`beebox/src/core/box-growth/scan.ts`, the `find` arguments prune `.git`,
`.beebox` and `node_modules`). Disk is the dimension that actually fails: the
production server reached 100% of its disk on 2026-08-04.

On the box that prompted
[box-growth-warning-cannot-clear](../bugs/2026-08-10-box-growth-warning-cannot-clear.md),
`.beebox` held about 193 MB against 415 MB of content, 165 MB of it one stale
search index. The check could not see any of it. A box whose file count is flat
while its bytes climb reports healthy.

That issue's level warnings were removed (size alone is no longer a finding),
so a byte dimension should follow the same rule: warn on byte *growth rate*,
not on a byte level.

## Open questions

- Measure `.beebox` separately and report it as engine overhead, so a
  boxholder is not told their content is growing when an index is?
- Sum bytes inside the existing `find` stream (`-printf %s` is GNU-only;
  macOS `find` lacks it), or `stat` per entry within the 10-second budget?
- Is a per-box rate enough, or does disk pressure need a server-level check
  across all boxes?
