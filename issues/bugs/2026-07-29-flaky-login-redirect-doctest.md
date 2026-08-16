---
title: "login-redirect doctest flakes under parallel suite runs"
workstream: finish-skill-audit
area: callback-box
filed-by: agent
discovered-in: worktree-finish-skill-audit — /finish full-suite run after merging main
next-action: reconfirm
---

`test/webapp/login-redirect.doctest.md` failed (jobId 3, exit 1) in a full
`pnpm test` run — three assertions inside the `makeTestServer({ openAccess:
false })` subtest got `actual: "undefined"` where a redirect Location header
(e.g. `/auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card`) was expected — but
passed cleanly (11/11) run in isolation (`npx tap
test/webapp/login-redirect.doctest.md`). Same shape as the tracked
[flaky-mobile-spa-fallback-doctest](../closed/bugs/2026-07-10-flaky-mobile-spa-fallback-doctest.md)
flake: a request that should redirect instead comes back with no `location`
header, only reproducible under the full suite's parallel load (`.taprc`
`jobs: 6`).

Not investigated further — the worktree that hit this touched neither the test
file nor the auth/login-redirect code it exercises, so treating it as
suite-contention noise for now per the tracked-flake protocol in
`.claude/agents/finish.md`. Next occurrence: capture the failing file's own
stdio from the parallel run before rerunning, same as the mobile-spa-fallback
issue's open next-step.
