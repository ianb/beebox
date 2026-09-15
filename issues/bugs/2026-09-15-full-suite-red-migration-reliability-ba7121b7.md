---
title: "Full-suite red: test/hub/hub-e2e.doctest.md"
workstream: migration-reliability
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-migration-reliability — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`90b84947`. Bisecting the landings since the last tested
commit (`0174ab03`) over first-parent `main` blames one landing:

- **Landing:** `ba7121b7` — Merge branch 'worktree-migration-reliability'
- **Workstream:** migration-reliability
- **Failing file:** `test/hub/hub-e2e.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 5 - test/hub/hub-e2e.doctest.md # time=153221.829ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/beebox
  externalID: test/hub/hub-e2e.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-BDyCGH/checkout/beebox/test/hub/hub-e2e.doctest.md
  exitCode: 1
  signal: null
  ...

# Subtest: test/webapp/routes/bulk-upload-routes.doctest.md
    # Subtest: bulk-upload-routes.doctest.md:68 — const ctx = await makeTestServer();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        1..4
    ok 1 - bulk-upload-routes.doctest.md:68 — const ctx = await makeTestServer(); # time=1639.524ms
    
    # Subtest: bulk-upload-routes.doctest.md:136 — const ctx = await makeTestServer();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 2 - bulk-upload-routes.doctest.md:136 — const ctx = await makeTestServer(); # time=112.802ms
```

Reproduce at the blamed landing:

```bash
git log -1 ba7121b7
pnpm --dir beebox exec tap test/hub/hub-e2e.doctest.md
```
