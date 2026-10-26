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
comparison, and `providerEnvAdditions` (`src/core/provider-env/core.ts`). Adding
one credential needed an edit in each, and review found spawn sites that build
a Claude CLI environment outside `providerEnvAdditions`. The Docker token bug
(issues/bugs/2026-10-25-docker-oauth-token-env-never-reaches-agent.md) is one
outcome of the split.

Coding feedback: box-isolation/20261025T210550Z-review-adjudicated.md,
box-isolation/20261025T205734Z-implemented.md,
box-isolation/20261025T004013Z-review-adjudicated.md.

Directions named in the entries: one table of credential variables and the
processes that may see each; a spawn helper that takes an allowlist, used by
every place that starts a process as another identity.
