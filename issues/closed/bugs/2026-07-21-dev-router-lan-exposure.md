---
title: "Dev router binds all interfaces while defaulting boxes to unauthenticated"
needs: [decision]
area: router
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
labels: [soft-launch]
resolution: implemented
---

**Resolved by main's removal of the `CB_ALLOW_UNAUTHENTICATED` path (commit
8499cc52) — dev is now structurally always-authenticated.** There is no open
mode left to expose over the LAN: the router no longer disables auth, so a LAN
peer reaching the outer router still hits the login wall. The remaining
follow-ups (fix login-behind-the-prefix for real; add a seeded-dev-credential
automation auth path) are tracked in
[dev-router-login-page-broken](2026-07-20-dev-router-login-page-broken.md).

**HIGH, and a regression from this session's own work.** Found by Codex
(2026-07-21), verified. The dev-router login fix
([dev-router-login-page-broken](2026-07-20-dev-router-login-page-broken.md))
made `bin/router-core.ts` default every worktree hub to
`CB_ALLOW_UNAUTHENTICATED=1` (`:334`). That was reasoned as safe because the
child hub binds `127.0.0.1`. But the **outer router** calls
`server.listen(ROUTER_PORT)` (`bin/router.ts:1052`) with **no host arg**, so
Node binds the unspecified address (`::`/`0.0.0.0`) — all interfaces —
despite logging "localhost". Verified: no host argument at that call site.

So a LAN / container / VM peer can reach the outer router, which proxies into
the loopback-only but now **auth-disabled** hub and boxes. Before the
overnight change the same LAN peer hit the login wall; now it doesn't. Scope
is the monorepo dev path only (`pnpm dev` → `bin/workstreams serve`); a real
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

**RESOLVED by boxholder policy (2026-07-21): dev is never open.** None of the
three options above — the fix is to stop disabling auth in dev at all.
Revert the `CB_ALLOW_UNAUTHENTICATED=1` router default, keep the login wall
genuinely enforced, and instead (a) fix login-behind-the-prefix for real
(the [dev-router-login-page-broken](2026-07-20-dev-router-login-page-broken.md)
problem the default was papering over) so a human can log in through the dev
router, and (b) add a testing provision — a seeded dev credential plus an
automation auth path (bin/browse / tours log in with it) — so headless
tooling authenticates rather than bypassing. Auth stays real; the LAN
exposure closes because there is no open mode to reach. Do not restart the
shared router; a code edit is picked up on the next restart the boxholder
does.
