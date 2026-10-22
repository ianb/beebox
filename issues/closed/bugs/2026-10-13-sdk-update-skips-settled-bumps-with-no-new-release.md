---
title: "sdk-update starts no session when versions settle but nothing new is published, so due bumps wait"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — scheduled run 20261013-203631
labels: [sdk-update]
resolution: implemented
---

**Closed 2026-10-17:** fixed on the bug-burndown branch ("sdk-update starts a session when a settled bump is unapplied"). `schedules/sdk-update/run.ts` also runs `bin/update-agent-sdk.ts --check`; a family it reports behind starts the session, and the briefing lists it under "Settled, not yet applied". A check that cannot run fails the schedule. Verified with `bin/schedules run sdk-update --dry-run` on 2026-10-17: no new releases, SDK pinned `0.3.300` with `0.3.301` settled, and the run would hand off "1 settled bump not yet applied". No `--force` run. Residual: a release the session holds back on purpose now starts a session every day until the pin moves or a newer release arrives.

The `sdk-update` runner starts an agent session only when a version is newer
than the ledger's **Latest reviewed upstream version** line. A version that the
agent reviewed while it was inside the two-day settling window does not count.
When that version settles on a day with no new publication, no session starts
and the pin does not move.

This happened on 2026-10-10, 10-11 and 10-12. Each run exited with
`sessionLaunched: false`. During those days SDK `0.3.294`, `0.3.295` and
`0.3.296` and Codex `0.162.0` and `0.162.1` settled. They were applied on
2026-10-13 only because `0.3.299` was published and started a session.

Cause: `schedules/sdk-update/run.ts` counts only versions newer than the
reviewed baseline (`newCount`) and exits 0 when the count is zero. Nothing
compares the pins in `beebox/package.json` with the newest settled versions.

A possible fix: the runner also starts a session when `pnpm update-agent-sdk
--check` reports a family as behind (it already applies the settling window).
The briefing then says "settled, not yet applied" next to any new versions.
