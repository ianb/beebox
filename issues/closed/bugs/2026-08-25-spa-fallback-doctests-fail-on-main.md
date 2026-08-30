---
title: "Two SPA-fallback doctests fail on main: page navigations 404 where they should redirect to login"
workstream: unattached
resolution: implemented
area: beebox
labels: [tests, auth]
filed-by: agent
discovered-by: agent
discovered-in: tab-identity workstream — surfaced by test:changed while touching server-root.ts
---

`test/webapp/login-redirect.doctest.md` and
`test/webapp/mobile-spa-fallback.doctest.md` fail on `main` (verified at
`5bc18dfda` by checking out that commit in a worktree and running them alone,
after they showed up in an unrelated change's `test:changed` selection). 7 of
17 assertions across the two files.

The shape of the failure is the same in both: a page navigation that the test
expects to be answered by the SPA fallback — a 302 to `/auth/login` with a
`returnTo`, or the mobile-authorized document — comes back **404 with no
`location` header** instead.

```
expected: status: 302, location: /main/auth/login?returnTo=%2Fmain%2Ftest%2Fbrowse%2Fsome-card
  actual: status: 404, location: undefined
```

## Why it matters more than a red test

The assertions cover the auth boundary on page navigations: an
unauthenticated navigation is supposed to *redirect to login carrying its
prefix*, and a mobile-authorized one is supposed to *get the document*. A 404
in the test server means either the fallback isn't installed in that
configuration or an earlier branch is claiming the request — and one of those
would be a real difference between the tested server and the deployed one.

So the useful first question is not "fix the test" but **which of the test
server and the real server is wrong**. `registerSpaFallback` only installs when
the built frontend exists (`server.ts:220`, `frontendExists`), which is a
plausible way for `makeTestServer` to end up with Fastify's default 404 handler
while a deployed box has the real one — if that's it, the tests have been
asserting against a server shape they don't actually construct, and the
coverage they appear to give is illusory.

## Not from the tab-identity work

Confirmed by running both files at `main` and at the commit before the box
identity change: identical failures. The tab-identity branch touches
`registerSpaFallback` (it stamps the box's name into the served document), which
is only why the selector surfaced them.

## Resolution (2026-08-25)

The test harness was the wrong one. `createServer` gated the SPA fallback on
`src/frontend/dist/index.html` — a gitignored build artifact — so the two
doctests passed in checkouts that had run `build:frontend` and 404'd in fresh
worktrees (6 of 20 worktrees lacked a build when checked). Prod unaffected:
deploy builds before starting. The ledger's 24 + 22 "unimplicated" failures of
these files are this.

Fix: `InternalServerOptions.frontendPath`; `makeTestServer` passes the tracked
`test/fixtures/frontend-dist/`, so every test server has the built shape.
`test/webapp` is 1007/1007 with and without a real build. Remaining
build-dependent test: `test/hub/hub-e2e.doctest.md` (drives a real `bbx hub`
subprocess and builds the frontend itself if absent).
