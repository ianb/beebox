---
title: "login-redirect doctest flakes under parallel suite runs"
workstream: finish-skill-audit
area: beebox
filed-by: agent
resolution: wontfix
discovered-in: worktree-finish-skill-audit — /finish full-suite run after merging main
priority: important
---

> **Closed 2026-09-04 — could not reproduce, and not fixed either.** Tagged
> `reconfirm`; removed. Roughly **40 runs, zero reproductions** of the reported
> `actual: "undefined"` Location-header failure: 20 isolated runs, two full
> `pnpm test` passes (7315/7315 and 7314/7315 — that one failure was an
> unrelated doctest), and three rounds of deliberate contention running it
> concurrently with the suite's heaviest files.
>
> No commit targets this file or the redirect logic in a way that reads as a
> flake fix, so there is nothing to close against — this is "cannot reproduce",
> not "resolved".
>
> Kept open deliberately. The closed sibling
> `closed/bugs/2026-07-10-flaky-mobile-spa-fallback-doctest.md` went `wontfix`
> after a similar campaign, but at ~140 runs against this one's ~40. What would
> settle it: seeing it fail once more, or a comparable volume of stress runs.

`test/webapp/login-redirect.doctest.md` failed (jobId 3, exit 1) in a full
`pnpm test` run — three assertions inside the `makeTestServer({ openAccess:
false })` subtest got `actual: "undefined"` where a redirect Location header
(e.g. `/auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card`) was expected — but
passed cleanly (11/11) run in isolation (`npx tap
test/webapp/login-redirect.doctest.md`). Same shape as the tracked
[flaky-mobile-spa-fallback-doctest](2026-07-10-flaky-mobile-spa-fallback-doctest.md)
flake: a request that should redirect instead comes back with no `location`
header, only reproducible under the full suite's parallel load (`.taprc`
`jobs: 6`).

Not investigated further — the worktree that hit this touched neither the test
file nor the auth/login-redirect code it exercises, so treating it as
suite-contention noise for now per the tracked-flake protocol in
`.claude/agents/finish.md`. Next occurrence: capture the failing file's own
stdio from the parallel run before rerunning, same as the mobile-spa-fallback
issue's open next-step.
