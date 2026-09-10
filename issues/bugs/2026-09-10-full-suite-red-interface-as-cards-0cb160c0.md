---
title: "Full-suite red: test/core/box/file-watcher.doctest.md"
workstream: interface-as-cards
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-interface-as-cards — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`0cb160c0`. Bisecting the landings since the last tested
commit (`c0a547b4`) over first-parent `main` blames one landing:

- **Landing:** `0cb160c0` — Merge branch 'worktree-interface-as-cards'
- **Workstream:** interface-as-cards
- **Failing file:** `test/core/box/file-watcher.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 1 - test/core/box/file-watcher.doctest.md # time=2441.37ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4tvl4T/checkout/beebox
  externalID: test/core/box/file-watcher.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4tvl4T/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4tvl4T/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4tvl4T/checkout/beebox/test/core/box/file-watcher.doctest.md
  exitCode: 1
  signal: null
  ...

# Subtest: test/field-test/lifecycle.doctest.md
    # Subtest: lifecycle.doctest.md:26 — const port = await allocateFreePort();
        ok 1 - (unnamed test)
        1..1
    ok 1 - lifecycle.doctest.md:26 — const port = await allocateFreePort(); # time=5.502ms
    
    # Subtest: lifecycle.doctest.md:38 — const runDir = await mkdtemp(join(tmpdir(), "bbx-field-run-"));
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        ok 6 - (unnamed test)
        ok 7 - (unnamed test)
        ok 8 - (unnamed test)
        ok 9 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 0cb160c0
pnpm --dir beebox exec tap test/core/box/file-watcher.doctest.md
```
