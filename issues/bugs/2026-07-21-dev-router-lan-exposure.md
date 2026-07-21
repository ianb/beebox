---
title: "Dev router binds all interfaces while defaulting boxes to unauthenticated"
needs: [decision]
area: router
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
---

**HIGH, and a regression from this session's own work.** Found by Codex
(2026-07-21), verified. The dev-router login fix
([dev-router-login-page-broken](../closed/bugs/2026-07-20-dev-router-login-page-broken.md))
made `bin/router-core.ts` default every worktree hub to
`CB_ALLOW_UNAUTHENTICATED=1` (`:334`). That was reasoned as safe because the
child hub binds `127.0.0.1`. But the **outer router** calls
`server.listen(ROUTER_PORT)` (`bin/router.ts:1052`) with **no host arg**, so
Node binds the unspecified address (`::`/`0.0.0.0`) — all interfaces —
despite logging "localhost". Verified: no host argument at that call site.

So a LAN / container / VM peer can reach the outer router, which proxies into
the loopback-only but now **auth-disabled** hub and boxes. Before the
overnight change the same LAN peer hit the login wall; now it doesn't. Scope
is the monorepo dev path only (`pnpm dev` → `bin/worktrees serve`); a real
`cb hub`/`cb serve` still defaults to loopback + validates open mode
(confirmed), so production is unaffected.

**Why this is a decision, not a clean one-liner:** binding the router to
`127.0.0.1` closes it, but the boxholder may test from a phone/other device
over the LAN against the dev router — loopback-binding breaks that workflow.
The real fork:

- Bind router loopback-only (lose LAN dev access), OR
- Keep LAN access but DON'T blanket-disable auth — revisit the login-page
  fix (the reverted alternative was making login work behind the prefix), OR
- Gate the `CB_ALLOW_UNAUTHENTICATED` default on the router's actual bind
  host (loopback bind → open ok; any-interface bind → keep auth).

The third option is probably the right shape: the open-mode default should be
contingent on the router genuinely being loopback-only, mirroring the
`enforceOpenModeAtListen` discipline the real `cb serve`/`cb hub` already use.
Boxholder's call — do not restart the shared router; a code edit is picked up
on the next restart he does.
