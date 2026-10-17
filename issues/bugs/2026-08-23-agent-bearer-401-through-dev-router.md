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

**2026-10-17 (bug-burndown-2):** still reproduces, one layer further in. With
the agent bearer from the worktree box's `.beebox/agent-token`,
`POST http://localhost:3210/bug-burndown-2/test1/api/chat/ui/request` returned
`401 {"error":"Not authenticated"}`. With no bearer or a wrong one, it returned
`401 {"error":"box-auth-required"}`. The different body shows that the dev
router now accepts the bearer (`workstreams-app/src/router/server/auth-deps.ts`,
`resolveMobileForBox`). The rejection comes from the worktree's beebox hub: its
catch-all wall (`beebox/src/hub/server/core.ts`, `app.all("/*")`) lets through
mobile auth, scan auth, the hub cookie, and the browse key, but not the agent
bearer, so it answers 401 before the request reaches the box child's
`verifyAgentBearer` hook. The hub was lazy, and no box child was running.
The fix would add the agent bearer to the hub's per-box auth. That is a change
to an auth surface, so it was not made in the stale check. Check whether
production's hub has the same gap before you choose.
