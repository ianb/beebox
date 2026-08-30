---
title: "Agent bearer requests 401 through the dev router; only the box child's port works"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-points-at-ui — verifying bbx chat ui by hand
priority: normal
---

Running `bbx chat ui` (and by the same path, `bbx chat screenshot`) with
`BBX_SERVER_URL=http://localhost:3210/<worktree>` returns `401 Not
authenticated` — the hub/router layer rejects the request before the box
route's `verifyAgentBearer` hook can accept the agent bearer. The same
request against the box child's own ephemeral port (from
`content/.beebox/hub-child.log`) succeeds.

Real box agents get the ambient server URL from `buildScriptEnv`, so this is
likely a manual-invocation-only wrinkle — but a developer or probe following
the router-URL convention hits a dead end with a misleading error. Either the
router should pass agent-bearer requests through to the box's own auth, or
the 401 should say the router does not carry agent auth and name the child
port log.
