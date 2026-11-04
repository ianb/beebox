---
title: "Credential environment variables are listed by hand in several allowlists"
workstream: unattached
area: beebox
labels: [security, env, box-isolation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
resolution: implemented
---

**Closed 2026-10-30.** `beebox/src/lib/credential-env.ts` gives every
credential variable a visibility (inherit, inject, blank, deny) for the hub
child, the agent and tooling profiles, and a Claude CLI run, with a reason.
The hub child allowlist, both box-subprocess allowlists, and the warm-slot
comparison take their credential entries from it.
`beebox/test/credential-visibility/every-consumer.test.ts` pins what every
consumer receives at its process boundary and checks the table against it.
Two leaks found on the way are fixed in their own commits: Codex agent runs
without explicit additions, and procedure shell steps, both got the whole
server environment. Plan: `beebox/docs/plans/credential-env-table.md`. The
spawn sites that still spread `process.env` are in
[claude-auth-commands-and-gws-spread-the-server-env](../../code-quality/2026-10-29-claude-auth-commands-and-gws-spread-the-server-env.md)
and
[view-metadata-import-runs-box-code-with-the-server-env](../bugs/2026-10-29-view-metadata-import-runs-box-code-with-the-server-env.md).
The issue's second direction, a spawn helper taking an allowlist, was not
built.

Which process sees a credential variable is decided in separate places: the
hub-to-child allowlist (`src/hub/supervisor/child-env.ts`), the agent script
allowlist (`src/core/script-env/allowlist.ts`), the warm-slot provider key
comparison, and `providerEnvAdditions` (`src/core/provider-env/core.ts`). Some
exclusions are deliberate (an ambient `CLAUDE_CODE_OAUTH_TOKEN` stays out of the
hub and agent lists; see
issues/closed/bugs/2026-10-25-docker-oauth-token-env-never-reaches-agent.md). Adding
the long-lived Claude token for per-box users meant keeping it out of the two
inherited-environment lists while adding it to the injection and the warm-slot
comparison, and review round 6 found spawn sites (scan import's SDK call, the
Codex engine) that build a Claude CLI environment outside
`providerEnvAdditions` or compare a fixed key list.

Coding feedback: box-isolation/20261025T210550Z-review-adjudicated.md,
box-isolation/20261025T205734Z-implemented.md,
box-isolation/20261025T004013Z-review-adjudicated.md.

Directions named in the entries: one table of credential variables and the
processes that may see each (exclusions included); a spawn helper that takes an allowlist, used by
every place that starts a process as another identity.
