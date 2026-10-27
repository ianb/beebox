---
title: "Full-suite red: test/user-stories/journey-phone-wait.test.ts"
workstream: box-isolation
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-isolation — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`67109abe`. Bisecting the landings since the last tested
commit (`c860baf7`) over first-parent `main` blames one landing:

- **Landing:** `67109abe` — Merge branch 'worktree-box-isolation'
- **Workstream:** box-isolation
- **Failing file:** `test/user-stories/journey-phone-wait.test.ts`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 1031 - test/user-stories/journey-phone-wait.test.ts # time=117098.381ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-bpwRCS/checkout/beebox
  externalID: test/user-stories/journey-phone-wait.test.ts
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-bpwRCS/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-bpwRCS/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
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
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-bpwRCS/checkout/beebox/test/user-stories/journey-phone-wait.test.ts
  jobId: 1
  exitCode: 1
  signal: null
  ...

# Subtest: test/user-stories/journey-phone.test.ts
    # Subtest: What a wait runs, and in what order
        ok 1 - (unnamed test)
        1..1
    ok 1 - What a wait runs, and in what order # time=21.164ms
    
    # Subtest: A wait refuses a card that comes due too often
        ok 1 - (unnamed test)
        1..1
    ok 2 - A wait refuses a card that comes due too often # time=8.459ms
    
    # Subtest: How long a wait is
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 67109abe
pnpm --dir beebox exec tap test/user-stories/journey-phone-wait.test.ts
```


## 2026-10-27: not reproduced on main

`pnpm exec tap test/user-stories/journey-phone-wait.test.ts` passes on main at `0d5d7a877` (exit 0). Check the hourly full-suite ledger for a green run since; if there is one, close as fixed. The two reds (2026-10-23 and 2026-10-25) are the same file.
