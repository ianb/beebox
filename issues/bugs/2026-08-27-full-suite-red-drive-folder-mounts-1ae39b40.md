---
title: "Full-suite red after Merge branch 'worktree-drive-folder-mounts': 1 test file failing"
workstream: drive-folder-mounts
area: callback-box
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-drive-folder-mounts — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`78470b9b`. Bisecting the landings since the last tested
commit (`97d60eb9`) over first-parent `main` blames one landing:

- **Landing:** `1ae39b40` — Merge branch 'worktree-drive-folder-mounts'
- **Workstream:** drive-folder-mounts
- **Failing file:** `test/frontend/lib/ui-scan/annotations.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 393 - test/frontend/lib/ui-scan/annotations.doctest.md # time=927.53ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-nnX3v2/checkout/callback-box
  externalID: test/frontend/lib/ui-scan/annotations.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-nnX3v2/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-nnX3v2/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-nnX3v2/checkout/callback-box/test/frontend/lib/ui-scan/annotations.doctest.md
  jobId: 5
  exitCode: 1
  signal: null
  ...

# Subtest: test/frontend/lib/ui-scan/scan.doctest.md
    # Subtest: scan.doctest.md:59 — const composer = scan(`
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 1 - scan.doctest.md:59 — const composer = scan(` # time=7.301ms
    
    # Subtest: scan.doctest.md:120 — lines(scan(`
        ok 1 - (unnamed test)
        1..1
    ok 2 - scan.doctest.md:120 — lines(scan(` # time=0.659ms
    
    # Subtest: scan.doctest.md:138 — lines(scan(`
        ok 1 - (unnamed test)
        1..1
```

Reproduce at the blamed landing:

```bash
git log -1 1ae39b40
pnpm --dir callback-box exec tap test/frontend/lib/ui-scan/annotations.doctest.md
```
