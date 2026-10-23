---
title: "Full-suite red: test/user-stories/journey-phone-wait.test.ts"
workstream: journey-walks-late-oct
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`d049e985`. Bisecting the landings since the last tested
commit (`af02fb58`) over first-parent `main` blames one landing:

- **Landing:** `d049e985` — Merge branch 'worktree-journey-walks-late-oct'
- **Workstream:** journey-walks-late-oct
- **Failing file:** `test/user-stories/journey-phone-wait.test.ts`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 976 - test/user-stories/journey-phone-wait.test.ts # time=307736.76ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kYnTAf/checkout/beebox
  externalID: test/user-stories/journey-phone-wait.test.ts
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kYnTAf/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kYnTAf/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
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
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kYnTAf/checkout/beebox/test/user-stories/journey-phone-wait.test.ts
  jobId: 4
  exitCode: null
  signal: SIGKILL
  ...

# Subtest: test/user-stories/journey-phone.test.ts
    # Subtest: What a wait runs, and in what order
        ok 1 - (unnamed test)
        1..1
    ok 1 - What a wait runs, and in what order # time=49.516ms
    
    # Subtest: A wait refuses a card that comes due too often
        ok 1 - (unnamed test)
        1..1
    ok 2 - A wait refuses a card that comes due too often # time=9.428ms
    
    # Subtest: How long a wait is
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 d049e985
pnpm --dir beebox exec tap test/user-stories/journey-phone-wait.test.ts
```
