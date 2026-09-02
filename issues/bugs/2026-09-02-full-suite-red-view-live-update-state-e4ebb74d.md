---
title: "Full-suite red: test/cli/lib/git.doctest.md"
workstream: view-live-update-state
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-view-live-update-state — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`e4ebb74d`. Bisecting the landings since the last tested
commit (`97fdc22e`) over first-parent `main` blames one landing:

- **Landing:** `e4ebb74d` — Merge branch 'worktree-view-live-update-state'
- **Workstream:** view-live-update-state
- **Failing file:** `test/cli/lib/git.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 29 - test/cli/lib/git.doctest.md # time=5541.722ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-d42U8q/checkout/beebox
  externalID: test/cli/lib/git.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-d42U8q/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-d42U8q/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-d42U8q/checkout/beebox/test/cli/lib/git.doctest.md
  jobId: 1
  exitCode: 1
  signal: null
  ...

# Subtest: test/cli/lib/init-v2.doctest.md
    # Subtest: init-v2.doctest.md:119 — const target = await makeTmpDir();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        ok 6 - (unnamed test)
        ok 7 - (unnamed test)
        ok 8 - (unnamed test)
        ok 9 - (unnamed test)
        ok 10 - (unnamed test)
        ok 11 - (unnamed test)
        ok 12 - (unnamed test)
        ok 13 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 e4ebb74d
pnpm --dir beebox exec tap test/cli/lib/git.doctest.md
```
