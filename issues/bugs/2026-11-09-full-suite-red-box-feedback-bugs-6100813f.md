---
title: "Full-suite red: test/core/browser/card-shot/run.e2e.test.ts"
workstream: box-feedback-bugs
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-feedback-bugs — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`4398f595`. Bisecting the landings since the last tested
commit (`9cc8ba4f`) over first-parent `main` blames one landing:

- **Landing:** `6100813f` — Merge branch 'worktree-box-feedback-bugs'
- **Workstream:** box-feedback-bugs
- **Failing file:** `test/core/browser/card-shot/run.e2e.test.ts`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 525 - test/core/browser/card-shot/run.e2e.test.ts # time=35096.58ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-Mq0OAv/checkout/beebox
  externalID: test/core/browser/card-shot/run.e2e.test.ts
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-Mq0OAv/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-Mq0OAv/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
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
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-Mq0OAv/checkout/beebox/test/core/browser/card-shot/run.e2e.test.ts
  jobId: 2
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/browser/card-shot/run.test.ts
    # Subtest: a card is named by /views/<path> or /chat?card=<path> on this box only
        ok 1 - (unnamed test)
        1..1
    ok 1 - a card is named by /views/<path> or /chat?card=<path> on this box only # time=1.983ms
    
    # Subtest: a card taller than its panel: grow, measure, capture, restore
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 2 - a card taller than its panel: grow, measure, capture, restore # time=6.358ms
    
    # Subtest: a page with no card says how to open one
        ok 1 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 6100813f
pnpm --dir beebox exec tap test/core/browser/card-shot/run.e2e.test.ts
```
