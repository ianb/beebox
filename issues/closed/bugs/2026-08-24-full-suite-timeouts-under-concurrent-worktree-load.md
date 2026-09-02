---
title: "field-test/run.doctest.md and hub-e2e.doctest.md time out in the full suite under concurrent worktree load"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — /finish full-suite verification
labels: [testing, flake]
resolution: superseded
---

A `/finish` full-suite run (`pnpm test`) failed with 6/7861 assertions down,
concentrated in two files, while several sibling worktree sessions were
concurrently running their own `pnpm test`/`pnpm lint`/`pnpm typecheck` on the
same machine (observed via `ps aux`: `knip-exports` and others active at the
same time):

- `test/field-test/run.doctest.md` — `run.doctest.md:199` (`bbx serve` boot)
  and `run.doctest.md:369` both timed out waiting on child-process readiness;
  the suite-level per-file timeout then expired the whole file
  (`not ok 619 - timeout! expired: test/field-test/run.doctest.md`).
- `test/hub/hub-e2e.doctest.md` — `execFileP("node", ["scripts/build-cli.mjs"])`
  took 184s (vs ~12.7s solo) and the subsequent `waitFor` timed out after
  120000ms waiting for the fixture box to report `status=running` via
  `/healthz`.

Both files pass cleanly in isolation (`npx tap -j1 <file>`): `run.doctest.md`
29/29 in ~233s solo, `hub-e2e.doctest.md` 9/9 in ~14.8s solo. Neither file nor
the code it exercises (field-test harness, hub CLI/e2e) was touched by the
branch that surfaced this. `.taprc` already documents that this class of
timeout is a known risk of loaded-machine contention ("Under full-core
parallelism, concurrent app boots and test work have historically thrashed the
machine into non-deterministic SIGALRM timeouts"), so this is very likely the
same class, just with a different pair of victim files than previously closed
port-collision/timing flakes (`closed/bugs/2026-08-14-hub-e2e-fixed-default-port-collides-across-worktrees.md`,
`closed/bugs/2026-08-02-run-target-doctest-timeout-under-parallel-load.md`).

Filed rather than fixed: no obvious code change here, the symptom is resource
contention, and `exploration/2026-08-08-run-less-of-the-test-suite.md` is
already tracking the structural fix (change-based test selection) that would
reduce how much runs concurrently in the first place.

## 2026-09-02 — closed: superseded

Consolidated with the other load-timeout filings into
[fixed-timeout-budgets-fail-under-host-load](../../bugs/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md);
the harness-side fix (quiet-host wait, slowdown-gated verdicts, import-cone
attribution) landed from the full-suite-verdicts workstream.
