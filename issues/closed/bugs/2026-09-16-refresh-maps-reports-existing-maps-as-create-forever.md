---
title: "refresh-maps reports existing MAP.md files as action:create in every run and never stamps them"
workstream: refresh-maps-correctness
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

The scheduled refresh-maps procedure reports the same directories as
`action: create` in every `--brief` run. Their MAP.md files exist and cover
their children. The agent rewrites them, git shows no diff, and nothing
stamps them in `.bbx-maps-state.json`. They return in the next run.

## Evidence

- Box A: 8 directories stuck from 2026-08-31 to at least 2026-09-08.
  None of them had an entry in `.bbx-maps-state.json`.
- Box B: the scheduled agent filed "refresh-maps brief false create
  bug recurs" nine times between 2026-08-31 and 2026-09-12.
- Two other boxes filed related reports (2026-08-31, 2026-09-03).
- Box C: `bookkeeping/MAP.md` stuck on 2026-09-14 and 2026-09-16.

## Findings from box agents

1. **Stale header after the one-root migration.** On 2026-09-08 an agent found
   that four of the stuck MAP.md files had a header line naming the old root
   (`Map: store/properties`). Correcting the header produced a real diff.
   Seven more MAP.md files on the same box still had the old header then. A
   file with a stale header is only reached when its children change.
2. **`--finalize` consumes the saved brief.** One agent ran
   `bbx refresh-maps --finalize` before editing. That deleted
   `.beebox/refresh-maps-brief.json`. The next bare `bbx refresh-maps`
   regenerated the brief at the post-edit head, so the diff window was empty
   and the real fix was not stamped.
3. **Untracked directories may have no path to a stamp.** Finalize appears to
   need the brief's `asOf` head to predate the fixing commit. Any intermediate
   `--brief` or bare run moves that pointer forward.

## Why resolution is not obvious

A directory with no state entry and a correct MAP.md needs a stamp without a
content diff. Whether finalize should stamp "verified unchanged", or whether
brief should seed state for existing maps, is a design choice. A one-time
sweep for the old-root header is separate, and may be a migration.

Related: [map-children-git-vs-disk](2026-08-24-map-children-git-vs-disk.md),
[validate-judge-lacks-ignore-policy](2026-08-24-validate-judge-lacks-ignore-policy.md).
