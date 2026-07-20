---
title: "Hub login page is unusable behind the dev router prefix"
area: router
filed-by: agent
discovered-in: worktree-lightbox-gestures — smoke-testing the lightbox needed auth and the login page couldn't render
---

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

Workaround used: mint a `cb_session` cookie directly (`signSession` from
`src/webapp/auth.ts` + `~/.cb-session-secret`, same idea as
`callback-box/deploy/prod-curl`) and install it in the browser.

Fix directions (pick during triage): base-path-aware login build / hub honoring
a forwarded prefix header from the router, or the router special-casing
`/assets/*` when the referer is a login page — or simply making dev-router
traffic skip hub auth (`CB_ALLOW_UNAUTHENTICATED=1` is loopback-gated already,
which is exactly the dev router case).
