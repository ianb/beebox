---
title: "Full-suite red: test/hub/hub-e2e.doctest.md"
workstream: migration-reliability
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-migration-reliability — the hourly full-suite run on main
---

> **Resolved in `0e37ecba0`.** The hub's fixture box had no Git repository,
> and the new admission gate lives in the Git directory. Left open only if the
> design question below gets an answer that changes the code.

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`90b84947`. Bisecting the landings since the last tested
commit (`0174ab03`) over first-parent `main` blames one landing:

- **Landing:** `ba7121b7` — Merge branch 'worktree-migration-reliability'
- **Workstream:** migration-reliability
- **Failing file:** `test/hub/hub-e2e.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 5 - test/hub/hub-e2e.doctest.md # time=153221.829ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/beebox
  externalID: test/hub/hub-e2e.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/beebox/test/hub/hub-e2e.doctest.md
  exitCode: 1
  signal: null
  ...

# Subtest: test/webapp/routes/bulk-upload-routes.doctest.md
    # Subtest: bulk-upload-routes.doctest.md:68 — const ctx = await makeTestServer();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        1..4
    ok 1 - bulk-upload-routes.doctest.md:68 — const ctx = await makeTestServer(); # time=1639.524ms
    
    # Subtest: bulk-upload-routes.doctest.md:136 — const ctx = await makeTestServer();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 2 - bulk-upload-routes.doctest.md:136 — const ctx = await makeTestServer(); # time=112.802ms
```

## Cause

`makeFixtureBox` built the box with `initBox(boxRoot, { skipGit: true })`, on
the stated premise that Git is "irrelevant to HTTP serving". `ba7121b7` made
that premise false: `src/hub/child-spawn.ts` now admits every box through
`acquireBoxStartup`, and `directoryFor` (`src/lib/box-maintenance.ts:33`) puts
the gate inside the Git directory and asserts one exists.

```
acquireBoxStartup("/tmp/gitless-box-KOHHLb")
  → Box maintenance requires a Git repository: /tmp/gitless-box-KOHHLb
```

So every start of the fixture box threw, and the failure surfaced only as the
readiness wait timing out after 120 s — which is why the captured diagnostic
named the CLI build rather than anything about Git.

The fixture now lets `initBox` create the repository it would create for any
real box. The test runs 9 assertions in about 3 s, against 2 assertions and
122 s before.

## The two paths do not actually disagree

Resolved here rather than left for the owning workstream.
`pendingMigrationsCheck` and `acquireBoxStartup` have different jobs, and each
is right for its own:

- **`pendingMigrationsCheck` reports.** `health` is an `inspection` command
  (`src/cli/lib/box-admission.ts:11`), so it runs on a box too broken to serve.
  Its job is to describe that box without throwing, and it already calls a
  missing repository what it is: "Git repository missing; migration recovery
  unavailable", `ok: false`. The `hasGit ?` guard is what lets it say so
  instead of dying.
- **`acquireBoxStartup` enforces.** A box whose admission gate cannot exist
  must not serve. Every real box is a Git repository — `bbx init` creates one,
  box commits carry trailers, migration recovery writes refs — so the assert
  states a true invariant.

So: keep both. A box without Git is not a supported shape, and the health check
is not claiming otherwise; it is diagnosing a box that is already broken.

## What was really missing: the reason never reached the operator

The engine surfaces this correctly and always did. The invariant's message
becomes `box.lastError` (`src/hub/supervisor.ts:466` via `describeError`), the
box goes `unhealthy`, and `getStatuses` puts `lastError` in `/healthz`
(`src/hub/supervisor.ts:425`).

The test threw it away. Its readiness wait polled for `status === "running"`
and discarded the body, so a bare label was all that survived:

```
waitFor: timed out after 120000ms waiting for the fixture box to report status=running via /healthz
```

The wait now keeps the last row, and the same failure reads:

```
… last row: {"slug":"fixture","status":"unhealthy","restarts":4,"consecutiveFailures":5,
             "lastError":"Box maintenance requires a Git repository: /var/folders/…/bbx-hub-e2e-TyM5Qp"}
```

Verified by re-breaking the fixture on purpose. No engine change was needed.

## 2026-09-16 recurrence in a second gitless fixture

Weekly `test:manual` (`schedules/manual-tests`, run `20260915-204151`, log
`~/src/schedule-runs/manual-tests/runs/20260915-204151.log`) failed at commit
`7894bba8f` on `main`, one file first-parent-descended from `ba7121b7`/
`969d97fa5`. `test/manual/chat-queue-real.doctest.md:46` builds its box with
plain `makeTmpBox()` (no `{ git: true }`), then constructs a `ChatSession` and
calls `session.send(...)`. `ChatSession.startRun` calls `acquireBoxWork`
(`src/core/chat/session/index.ts:307`), which hits the same assert as the
hub-e2e case:

```
not ok 1 - Box maintenance requires a Git repository: /var/folders/.../T/bbx-doctest-BBhBR5
  stack: |
    invariant (src/lib/invariant.ts:58:20)
    <anonymous> (src/lib/box-maintenance.ts:37:7)
```

Same mechanism as the hub-e2e fixture above (`directoryFor` in
`box-maintenance.ts:33` asserts a Git dir for every admitted box), a different
call site (`acquireBoxWork` on an ordinary chat send, not
`acquireBoxStartup` on hub startup) and a different fixture
(`test/helpers/doctest-helpers.ts`'s `makeTmpBox()` default, not
`makeFixtureBox`'s `initBox({ skipGit: true })`). Unlike hub-e2e, nobody has
fixed this call site yet — the whole doctest now fails before sending a single
message, so the weekly suite is not exercising real-SDK queue-draining
behavior at all (this is the doctest that specifically proves the "second
message never processed" class of user report; see the closed
[chat-queue-real hard-fails on lapsed login](../closed/bugs/2026-09-08-chat-queue-real-hard-fails-on-lapsed-claude-login.md)
issue for its other failure modes).

Given the "not a supported shape" resolution above, the fix here is the same
shape as the hub-e2e one: pass `{ git: true }` to this test's `makeTmpBox()`
call (and audit other manual/doctest fixtures that construct a `ChatSession`
or otherwise call into `acquireBoxWork`/`acquireBoxMaintenance` over a gitless
box — this makes two independent fixtures caught by the same trap within a
day of the landing).
