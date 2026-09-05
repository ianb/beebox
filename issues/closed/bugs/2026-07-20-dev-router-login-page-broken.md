---
title: "Hub login page is unusable behind the dev router prefix"
workstream: lightbox-gestures
area: router
filed-by: agent
discovered-in: worktree-lightbox-gestures — smoke-testing the lightbox needed auth and the login page couldn't render
resolution: implemented
---

**Closed 2026-07-21** — fixed for real this time by Track A of the
`expose-dev-router` plan (`beebox/docs/implemented-plans/expose-dev-router.md`),
landed as commit `4917fad4` ("Track A DONE (login-behind-prefix bug fixed,
browser-verified)") plus its constituent commits (`8698f41c`, `c4c29053`,
`cf9e879e`). The fix took the base-path-aware route this issue's "Boxholder
flag" section said was NOT taken previously: `x-bbx-Base-Prefix` header +
`validateBasePrefix`/`loginRedirect` (`src/webapp/base-prefix.ts`) reconstruct
the full path for server-side redirects, and Vite now serves a base-aware
login SPA in dev so its asset references resolve behind the `/<worktree>/`
prefix. Browser-verified working behind the prefix.

**Reopened 2026-07-21** — the `BBX_ALLOW_UNAUTHENTICATED` workaround was dropped
when main removed open-mode (commit 8499cc52; auth is now structurally
always-on). Login behind the dev-router prefix is broken again and needs a
proper fix (prefix-aware login SPA / router asset rewrite) under the
dev-never-open policy — the "make login actually work behind the prefix"
directions below, not another auth-skip. The previous "Resolved" note is kept
below for history but no longer applies.

**Previously resolved** by taking the fourth fix direction below (dev-router skips hub
auth). The router now spawns each worktree's hub with
`BBX_ALLOW_UNAUTHENTICATED=1` by default (`bin/router-core.ts`, in `childEnv`),
so dev traffic never hits the broken login SPA: no login redirect (problem 2)
and no login assets to 404 (problem 1). It's loopback-bind-gated and the hub
binds `127.0.0.1`; a hub in open mode advertises `x-bbx-hub-auth: off` to its box
children, so no per-box env is needed. An explicit `BBX_ALLOW_UNAUTHENTICATED`
value is respected. Covered by two tests in `bin/router-core.test.ts`;
documented in `bin/CLAUDE.md`.

**Boxholder flag / decision:** the two "make login actually work behind the
prefix" directions (base-path-aware login build; router routing hub-root
`/assets`+`/auth` back to the worktree) were NOT taken — they require rework of
the router↔Vite↔hub asset chain (Vite dev doesn't hold the hub's built dist
assets and doesn't proxy `/assets` to the hub), which is a much larger, harder-
to-test change on the SHARED router. The consequence of the chosen fix: dev
sessions now have no signed-in email identity, and the real login/OAuth flow
can't be exercised behind the dev router (use a standalone `bbx serve` for that).
If that tradeoff isn't acceptable, reopen for the base-path-aware approach.

Two stacked problems make `auth/login` a dead end under the dev router:

1. **The login SPA ships absolute asset paths.** `GET
   /<worktree>/auth/login` serves the *built* login page whose HTML references
   `/assets/index-<hash>.js` — the router reads `assets` as a worktree name, the
   script 404s, and the page renders an empty `<div id="root">`: no form, no
   error.
2. **The hub's login redirect strips the worktree prefix.** Some redirects land
   on `/auth/login?returnTo=/test1/...` (no `/<worktree>/` prefix), which the
   router answers with `Failed to start worktree auth: Worktree "auth" not
   found`.

Workaround used: mint a `bbx_session` cookie directly (`signSession` from
`src/webapp/auth.ts` + `~/.beebox-session-secret`, same idea as
`beebox/deploy/prod-curl`) and install it in the browser.

Fix directions (pick during triage): base-path-aware login build / hub honoring
a forwarded prefix header from the router, or the router special-casing
`/assets/*` when the referer is a login page — or simply making dev-router
traffic skip hub auth (`BBX_ALLOW_UNAUTHENTICATED=1` is loopback-gated already,
which is exactly the dev router case).
