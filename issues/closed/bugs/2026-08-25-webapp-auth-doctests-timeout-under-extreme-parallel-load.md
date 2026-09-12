---
title: "test/webapp/{login-redirect,password-*,push-subscribe}.doctest.md and api-csp-report-bounds time out in the full suite under extreme concurrent worktree load"
workstream: live-vs-stored
area: beebox/test
labels: [testing, flake, timeout, load]
filed-by: agent
discovered-by: agent
discovered-in: worktree-live-vs-stored — /finish full-suite re-run
resolution: superseded
---

A `/finish` full-suite `pnpm test` run (post-merge re-verification, HEAD
`03c0f8b2`) failed 13 of 7982 assertions, all timeout-shaped, while `uptime`
showed load averages 19.82/39.93/37.11 and `ps aux` showed 11 concurrent
`pnpm test`/`pnpm lint` processes from sibling worktree sessions
(`test-economics`, `connector-integrity`, `chat-wayfinding`, `composer-intake`
among them):

```
not ok 569 - test/webapp/login-redirect.doctest.md # time=986264.209ms
not ok 574 - test/webapp/password-change.doctest.md # time=983452.47ms
not ok 575 - test/webapp/password-login.doctest.md # time=983281.119ms
not ok 576 - test/webapp/password-reset.doctest.md # time=982395.018ms
not ok 577 - test/webapp/push-subscribe.doctest.md # time=980545.721ms
not ok 578 - test/webapp/routes/api-csp-report-bounds.doctest.md # time=978384.268ms
not ok 623-628 - timeout! (expired: same 6 files, second listing)
```

All six files ran ~983s (16+ minutes) before the suite-level timeout expired
them — consistent with the machine being thrashed by concurrent full-suite
runs from other sessions, not a logic defect.

## Isolation

Re-ran all six files together in isolation immediately after (still under
some load — sibling sessions were still active):

```
npx tap -j1 test/webapp/login-redirect.doctest.md test/webapp/password-change.doctest.md \
  test/webapp/password-login.doctest.md test/webapp/password-reset.doctest.md \
  test/webapp/push-subscribe.doctest.md test/webapp/routes/api-csp-report-bounds.doctest.md
# { total: 68, pass: 68 }
```

All pass, ~63s total. The branch under test (`worktree-live-vs-stored`,
commit `656ad1e9` — a refactor of session-transcript readers) touches none of
these files or the code they exercise (webapp auth routes, push subscriptions,
CSP report bounds).

## Relationship to prior reports

Same contention class already documented for different victim files:
`issues/bugs/2026-08-24-timeout-doctests-flake-under-extreme-parallel-load.md`
(auto-sweep-detach, field-test/lifecycle, field-test/run) and
`issues/bugs/2026-08-24-full-suite-timeouts-under-concurrent-worktree-load.md`
(field-test/run, hub-e2e). This instance adds a third distinct set of victim
files (webapp auth/push/CSP-report doctests), reinforcing that the timeout
victims are whichever files happen to be running when contention peaks, not a
property of the files themselves. The structural fix
(`issues/exploration/2026-08-08-run-less-of-the-test-suite.md`, change-based
test selection / running less concurrently) is the tracked remedy.

## Handling

Filed rather than fixed — isolated run is clean, the branch didn't touch any
of the affected code, and this is a duplicate instance of an already-tracked
environmental condition. No action taken beyond filing.

## 2026-09-02 — closed: superseded

Consolidated with the other load-timeout filings into
[fixed-timeout-budgets-fail-under-host-load](../../deferred/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md);
the harness-side fix (quiet-host wait, slowdown-gated verdicts, import-cone
attribution) landed from the full-suite-verdicts workstream.
