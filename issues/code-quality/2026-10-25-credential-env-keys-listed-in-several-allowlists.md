---
title: "Credential environment variables are listed by hand in several allowlists"
workstream: unattached
area: beebox
labels: [security, env, box-isolation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

Which process sees a credential variable is decided in separate places: the
hub-to-child allowlist (`src/hub/supervisor/child-env.ts`), the agent script
allowlist (`src/core/script-env/allowlist.ts`), the warm-slot provider key
comparison, and `providerEnvAdditions` (`src/core/provider-env/core.ts`). Some
exclusions are deliberate (an ambient `CLAUDE_CODE_OAUTH_TOKEN` stays out of the
hub and agent lists; see
issues/bugs/2026-10-25-docker-oauth-token-env-never-reaches-agent.md). Adding
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
