---
title: "Full-suite red: test/lib/git.box-clock.test.ts"
workstream: perf-easy-wins
area: beebox
priority: important
resolution: superseded
filed-by: agent
discovered-by: agent
discovered-in: worktree-perf-easy-wins — the hourly full-suite run on main
---

**Closed 2026-10-23 (superseded by f1e4f1ad3).** The failure was the test's
date boundary, not this landing: `test/lib/git.box-clock.test.ts` compared
the date part of a local `%aI` stamp with a UTC day, so it failed once the
clock passed 00:00 UTC (19:00 CDT), whichever commit was checked out. The
bisect ran after that point and blamed the landing it happened to test.
`f1e4f1ad3` ("Test: git box-clock compares commit days in UTC") fixed the
test on `main`. Checked 2026-10-24 at 01:43 UTC: the test failed on this
branch before merging `main` and passed (6 of 6) after.

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`07bb777e`. Bisecting the landings since the last tested
commit (`29389f94`) over first-parent `main` blames one landing:

- **Landing:** `01bd268c` — Merge branch 'worktree-perf-easy-wins'
- **Workstream:** perf-easy-wins
- **Failing file:** `test/lib/git.box-clock.test.ts`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 867 - test/lib/git.box-clock.test.ts # time=16006.815ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-W6lqcb/checkout/beebox
  externalID: test/lib/git.box-clock.test.ts
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-W6lqcb/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-W6lqcb/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=@ianbicking/tap-check/tap
    - --import=./src/frontend/test/helpers/react-compiler-register.ts
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - --import=./test/helpers/quiet-chat-session-log.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-W6lqcb/checkout/beebox/test/lib/git.box-clock.test.ts
  jobId: 1
  exitCode: 1
  signal: null
  ...

# Subtest: test/lib/git.commit-hook-rejection.test.ts
    # Subtest: The commit throws, and HEAD is where it was:
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        1..5
    ok 1 - The commit throws, and HEAD is where it was: # time=2497.593ms
    
    1..1
```

Reproduce at the blamed landing:

```bash
git log -1 01bd268c
pnpm --dir beebox exec tap test/lib/git.box-clock.test.ts
```
