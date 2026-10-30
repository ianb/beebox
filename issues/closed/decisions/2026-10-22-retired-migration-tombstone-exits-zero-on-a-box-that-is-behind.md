---
title: "The retired-migration tombstone exits 0, so a box that never applied a retired migration records it as applied"
workstream: unattached
area: beebox
labels: [migrations]
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

Decided: yes. `retired.ts` now exits 1 with a message naming the migration (passed as `BBX_MIGRATION_NAME`), the retirement commit, and the "Retired migrations" doc section. The sweep treats an entry that points at the tombstone (`isRetiredMigration`) as needing a human: with repair on it writes the question card without invoking the agent. `beebox/docs/cards/migrations.md` describes it. The text below is the original filing.

Commit 81c647230 retired every migration registered before 2026-10-08 and
pointed each entry at `beebox/src/scripts/migrate/retired.ts`, which exits 0
and writes nothing. The boxholder confirmed every fleet box had applied them.

A box outside the fleet is the gap. `beebox/docs/cards/migrations.md` (the
"Retired migrations" section) says such a box "needs that migrator restored
from git history and run by hand". But any `--sweep` or `--apply` on it records
every retired entry as applied with no conversion, and once the manifest says
applied, nothing can detect the gap. It fails open.

One local box outside `BOXES` has 54 manifest entries, so 19 migrations are
pending for it and 13 of those are retired, including `v2-refs-to-v3`,
`filename-attach-scope`, `feedback-to-doc-cards`, `standard-fields-2026-09`,
and `publication-cards-2026-10`. The hourly pass has not reached it because it
is not in `BOXES`.

## Decision

Should `retired.ts` exit 1 with a message ("this box predates the 2026-10-08
retirement; restore the migrator from git history") instead of 0? It only ever
runs on a box that never applied that entry, which is exactly the case the doc
describes. The cost is that such a box then blocks on the first retired entry
and, with repair on, gets a question card. Exit 0 was a deliberate choice in
the retirement commit, so this is the developer's call.
