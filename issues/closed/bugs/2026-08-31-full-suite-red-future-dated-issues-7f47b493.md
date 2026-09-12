---
title: "Full-suite red: test/frontend/trpc-directory-resolution.test.ts"
workstream: future-dated-issues
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-future-dated-issues — the hourly full-suite run on main
resolution: superseded
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`8c518bfb`. Bisecting the landings since the last tested
commit (`65f5d211`) over first-parent `main` blames one landing:

- **Landing:** `7f47b493` — Merge branch 'worktree-future-dated-issues'
- **Workstream:** future-dated-issues
- **Failing file:** `test/frontend/trpc-directory-resolution.test.ts`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 432 - test/frontend/trpc-directory-resolution.test.ts # time=28256.359ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-0f1VKz/checkout/beebox
  externalID: test/frontend/trpc-directory-resolution.test.ts
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-0f1VKz/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-0f1VKz/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-0f1VKz/checkout/beebox/test/frontend/trpc-directory-resolution.test.ts
  jobId: 5
  exitCode: 1
  signal: null
  ...

# Subtest: test/frontend/turn-message-stream.doctest.md
    # Subtest: turn-message-stream.doctest.md:49 — const { text } = runTurn([
        ok 1 - (unnamed test)
        1..1
    ok 1 - turn-message-stream.doctest.md:49 — const { text } = runTurn([ # time=17.939ms
    
    # Subtest: turn-message-stream.doctest.md:62 — const { text } = runTurn([
        ok 1 - (unnamed test)
        1..1
    ok 2 - turn-message-stream.doctest.md:62 — const { text } = runTurn([ # time=6.157ms
    
    # Subtest: turn-message-stream.doctest.md:78 — const { text, tools } = runTurn([
        ok 1 - (unnamed test)
        1..1
    ok 3 - turn-message-stream.doctest.md:78 — const { text, tools } = runTurn([ # time=5.065ms
```

Reproduce at the blamed landing:

```bash
git log -1 7f47b493
pnpm --dir beebox exec tap test/frontend/trpc-directory-resolution.test.ts
```

## 2026-09-02 — verified stale (survey note)

Passes on `main` at `01791868b` in isolation (1/1, 2.2s). The blamed landing
`7f47b493` touched `bin/`, `schedules/`, `issues/`, `src/dev/doc-frontmatter.ts`
and workstreams-app — nothing under `src/frontend/` or this test. In the hourly
run's own isolated re-run, children 5, 10, 11 and 12 of the 12 concurrent
loader children failed with a bare `Command failed:` and the test took 15.2s,
which is the test's 15s per-child `execFile` timeout. That is machine
contention, not the landing; the "failed again in isolation" verdict was made
on the same loaded machine. Mis-attribution by `schedules/full-suite/`.

## 2026-09-02 — closed: false red

Verified stale (note above): the failure was host contention, and the blamed
landing cannot reach the failing file. An instance of
[fixed-timeout-budgets-fail-under-host-load](../../deferred/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md);
the mis-attribution itself is fixed by the full-suite-verdicts workstream
(slowdown-gated verdicts + import-cone attribution in schedules/full-suite/).
