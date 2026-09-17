---
title: "Full-suite red: test/box-inventory.doctest.md, test/cli/lib/init.doctest.md"
workstream: secret-endpoint-derivation
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-secret-endpoint-derivation — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`eaa9703b`. Bisecting the landings since the last tested
commit (`28c2ed93`) over first-parent `main` blames one landing:

- **Landing:** `b301ecf6` — Merge branch 'worktree-secret-endpoint-derivation'
- **Workstream:** secret-endpoint-derivation
- **Failing files:** `test/box-inventory.doctest.md`, `test/cli/lib/init.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 2 - test/box-inventory.doctest.md # time=13164.5ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/beebox
  externalID: test/box-inventory.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/beebox/test/box-inventory.doctest.md
  jobId: 2
  exitCode: 1
  signal: null
  ...

# Subtest: test/box-shape.doctest.md
    # Subtest: box-shape.doctest.md:52 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        1..1
    ok 1 - box-shape.doctest.md:52 — const box = await makeTmpBox(); # time=223.669ms
    
    # Subtest: box-shape.doctest.md:66 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        1..1
    ok 2 - box-shape.doctest.md:66 — const box = await makeTmpBox(); # time=77.885ms
    
    # Subtest: box-shape.doctest.md:80 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        1..1
    ok 3 - box-shape.doctest.md:80 — const box = await makeTmpBox(); # time=82.423ms

not ok 46 - test/cli/lib/init.doctest.md # time=3776.609ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/beebox
  externalID: test/cli/lib/init.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-qdKciw/checkout/beebox/test/cli/lib/init.doctest.md
  jobId: 5
  exitCode: 1
  signal: null
  ...

# Subtest: test/cli/lib/paths.doctest.md
    # Subtest: paths.doctest.md:28 — parseCardName("Test.memo.card")
        ok 1 - (unnamed test)
        1..1
    ok 1 - paths.doctest.md:28 — parseCardName("Test.memo.card") # time=2.876ms
    
    # Subtest: paths.doctest.md:39 — parseCardName("Meeting_Tomorrow.email-thread.card")
        ok 1 - (unnamed test)
        1..1
    ok 2 - paths.doctest.md:39 — parseCardName("Meeting_Tomorrow.email-thread.card") # time=0.361ms
    
    # Subtest: paths.doctest.md:51 — parseCardName("nav.card")
        ok 1 - (unnamed test)
        1..1
    ok 3 - paths.doctest.md:51 — parseCardName("nav.card") # time=0.179ms
```

Reproduce at the blamed landing:

```bash
git log -1 b301ecf6
pnpm --dir beebox exec tap test/box-inventory.doctest.md test/cli/lib/init.doctest.md
```
