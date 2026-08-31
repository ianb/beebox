---
title: "Full-suite red: test/core/box/file-watcher.doctest.md"
workstream: name-change-plan
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-name-change-plan — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`def4435c`. Bisecting the landings since the last tested
commit (`39c8b854`) over first-parent `main` blames one landing:

- **Landing:** `def4435c` — Merge branch 'worktree-name-change-plan'
- **Workstream:** name-change-plan
- **Failing file:** `test/core/box/file-watcher.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 1 - test/core/box/file-watcher.doctest.md # time=52577.791ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-p69ohw/checkout/beebox
  externalID: test/core/box/file-watcher.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-p69ohw/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-p69ohw/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-p69ohw/checkout/beebox/test/core/box/file-watcher.doctest.md
  exitCode: 1
  signal: null
  ...

# Subtest: test/field-test/lifecycle.doctest.md
    # Subtest: lifecycle.doctest.md:27 — const port = await allocateFreePort();
        ok 1 - (unnamed test)
        1..1
    ok 1 - lifecycle.doctest.md:27 — const port = await allocateFreePort(); # time=8.674ms
    
    # Subtest: lifecycle.doctest.md:40 — const runDir = await mkdtemp(join(tmpdir(), "bbx-field-run-"));
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
```

Reproduce at the blamed landing:

```bash
git log -1 def4435c
pnpm --dir beebox exec tap test/core/box/file-watcher.doctest.md
```
