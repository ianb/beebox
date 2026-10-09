---
title: "Journey agent-time counts chat-title sessions as turns and skips place-chat transcripts"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry, A-lending, B-inventory, C-reconnecting, F-newcomer journey walks, 2026-10-09
resolution: implemented
---

Fixed 2026-10-09: `agent-time.ts` reads the box root's transcript directory and every `<box>--*` place-chat directory, and skips sessions the box's usage manifest names (chat-title and other engine agent runs; a live chat never appears there). An even-count median now averages the middle two. Recollected D2: 8 turns, 2.4 min, median 19 s (18.75), slowest 38 s, as the report measured by hand. C 11, F 10, D 12, B 10 turns.

`beebox/test/user-stories/journeys/agent-time.ts` reports wrong turn counts and timings. Two errors, one file.

**Title sessions count as turns.** It reads every `.jsonl` in the box-root transcript directory (`agent-time.ts:39`). The chat-title job (added 2026-10-08, `b57baccb3`) runs its own Claude session in that directory, so each title run counts as a chat turn. Effect: D 13 turns instead of 12; C 12 instead of 11; F 11 instead of 10; A three of six collected turns were title sessions.

**Place chats are skipped.** A place chat writes to a different transcript directory (for example `…--content-inventory`), and `agent-time.ts` reads only the box-root one. `README.md:95` and the header comment (`agent-time.ts:4`) document that scoped chats are excluded. Landmark arrival (see [landmark-arrival](../../../beebox/docs/implemented-plans/landmark-arrival.md)) made a place chat an ordinary path, so the exclusion now loses real turns: B missed 3 of 10; A missed seven real turns in the Loans chats; the second D walk missed 3 of 8 and its mid-walk clock reported 7 s for turns that took 21.7 s and 10.4 s.

Walkers use the figure for their mid-walk and final clocks, so both errors reach the reports.

Fix direction: skip files whose first entry is a title or review session (the session name or prompt marks them), and read the place-chat directories of the walk's box (all `<box>--*` project directories). Update the README line.


Reports: [D](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) (H3), [D2](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) (H2), [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (H3), [A](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (H3), [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) (H1), [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (H2).
