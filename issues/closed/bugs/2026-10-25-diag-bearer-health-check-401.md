---
title: "The diagnostic bearer no longer reaches a box's `health.check`: 401 on production and on a fresh unit host"
workstream: box-isolation-followups
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: box-isolation — the fresh-VPS test of 2026-10-25
labels: [health, auth]
resolution: implemented
---

**Closed 2026-10-27 (box-isolation-followups).** The hub's own auth wall
(`src/hub/server/core.ts`) had no case for the diagnostic bearer, so it 401'd
every call before the box saw it. The box scope's bypass works, outside and
inside hub mode (`beebox/test/webapp/auth.diag-bypass.test.ts`). The hub now
proxies a whitelisted GET with a valid key without identity, and the box checks
the key again (`beebox/test/hub/server.auth.test.ts`). The report of a 401
straight at a box's unix socket is not reproduced locally; confirm on
production after deploy.

`docs/server/operations.md` ("Live health") tells a machine caller to run

```bash
curl -H "Authorization: Bearer $BBX_DIAG_API_KEY" \
  'https://box.example.com/<box>/api/trpc/health.check?input=%7B%22fresh%22%3Atrue%7D'
```

and `src/webapp/auth.ts` (`isDiagnosticBypassRequest`, applied in
`src/webapp/server-box-scope.ts`) whitelists `health.check`, `debugLog.get`
and `chat.statusAll` for a GET with that bearer. On 2026-10-25 the call
answered `401 {"error":"Not authenticated"}` on production (old layout, through
the hub) and on a freshly provisioned unit host (through the hub, through
nginx, and straight at the box's unix socket), with the box process holding
the same `BBX_DIAG_API_KEY` as the hub (compared by hash). `debugLog.get`
answers the same. The hub's own `/healthz` and `/healthz/canary` accept the
key, so the deploy's verification is unaffected.

Not investigated further: whether the bypass still runs before the identity
resolution that returns the 401 (`server-box-scope.ts:137`), or whether a
later hook re-checks identity for tRPC procedures. Either the bypass is dead
and the doc and the whitelist should go, or it is broken and `bin/deploy-status`
style callers have lost their live health read. `test/webapp/` has a test for
the batch-URL widening; a test that drives a real request with the bearer
through the box scope would show which.
