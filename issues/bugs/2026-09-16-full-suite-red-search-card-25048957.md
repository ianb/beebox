---
title: "Full-suite red: test/box-inventory.doctest.md, test/core/migration-gitignore.doctest.md"
workstream: search-card
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-search-card — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`25048957`. Bisecting the landings since the last tested
commit (`b8da24e4`) over first-parent `main` blames one landing:

- **Landing:** `25048957` — Merge branch 'worktree-search-card'
- **Workstream:** search-card
- **Failing files:** `test/box-inventory.doctest.md`, `test/core/migration-gitignore.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 2 - test/box-inventory.doctest.md # time=4577.959ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/beebox
  externalID: test/box-inventory.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/beebox/test/box-inventory.doctest.md
  jobId: 2
  exitCode: 1
  signal: null
  ...

# Subtest: test/box-shape.doctest.md
    # Subtest: box-shape.doctest.md:52 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        1..1
    ok 1 - box-shape.doctest.md:52 — const box = await makeTmpBox(); # time=97.423ms
    
    # Subtest: box-shape.doctest.md:66 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        1..1
    ok 2 - box-shape.doctest.md:66 — const box = await makeTmpBox(); # time=58.203ms
    
    # Subtest: box-shape.doctest.md:80 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        1..1
    ok 3 - box-shape.doctest.md:80 — const box = await makeTmpBox(); # time=80.923ms

not ok 247 - test/core/migration-gitignore.doctest.md # time=5814.872ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/beebox
  externalID: test/core/migration-gitignore.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mMDkNB/checkout/beebox/test/core/migration-gitignore.doctest.md
  jobId: 3
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/migration-hooks.doctest.md
    # Subtest: migration-hooks.doctest.md:23 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)
        1..1
    ok 1 - migration-hooks.doctest.md:23 — const box = await makeTmpBox({ git: true }); # time=2818.545ms
    
    1..1
```

Reproduce at the blamed landing:

```bash
git log -1 25048957
pnpm --dir beebox exec tap test/box-inventory.doctest.md test/core/migration-gitignore.doctest.md
```
