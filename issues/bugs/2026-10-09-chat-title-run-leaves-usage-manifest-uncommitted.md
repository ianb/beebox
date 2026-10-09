---
title: "A chat-title run leaves the usage manifest uncommitted"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry, A-lending, B-inventory, C-reconnecting, F-newcomer journey walks, 2026-10-09
---

Every journey walk ended with `_bookkeeping/usage/session-manifest.jsonl`
untracked or modified, with one `chat-title:<session>` line per title run:
one line in D-chemistry and F-newcomer, two in A-lending, three in B-inventory
and the second D-chemistry walk. Nothing committed it during the walk.

A-lending: the first manifest line was committed only because an unrelated
trick auto-commit swept the whole tree (see
[trick-auto-commit-whole-tree-race-and-secrets](2026-09-21-trick-auto-commit-whole-tree-race-and-secrets.md)).

## Mechanism

An agent run appends one line when its session id arrives
(`beebox/src/core/agent/manifest.ts:20-24`, called from
`beebox/src/core/agent/invoke/core.ts:60`). In these walks only the title runs
wrote lines; the chat turns themselves wrote none.
The path is a tracked bookkeeping path
(`beebox/src/lib/paths/box-layout-spec.ts:205-210`). Nothing in the chat-title
path stages or commits it, so the box stays dirty after each title. Every chat
now produces a title run (landed 2026-10-08/09), so the file is dirty after
every first exchange. Unverified: whether a later reactor or procedure commit
on a box with schedules sweeps it. Test boxes have schedules disabled.

## Why the fix is not obvious

Options: commit the manifest with the next box commit that already runs, ignore
the file in git, or stop recording title runs. A dirty tree is visible in the
Dashboard and is swept into whichever auto-commit runs next, under that
commit's name. Choosing needs a look at who reads the manifest (`bbx usage`).

Related: [conversation-keeps-placeholder-title](../closed/bugs/2026-10-08-conversation-keeps-placeholder-title.md)
(closed; it added the per-chat title run).

Reports: [D-chemistry](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) R4,
[A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) R4,
[B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) R4,
[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) R2,
[F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) R4,
[D-chemistry second walk](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) R3.
