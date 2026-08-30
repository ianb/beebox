---
title: "Full-suite red after docs(issues): sticky HQ transcription preference: 1 test file failing"
workstream: unattached
area: beebox
priority: important
filed-by: agent
discovered-by: agent
resolution: superseded
---

> Closed 2026-08-27: one of twelve hourly duplicates of [the first report](2026-08-27-full-suite-red-drive-folder-mounts-1ae39b40.md) — the schedule re-bisected the same annotations.doctest.md failure each hour and blamed its own previous report commit. The loop is filed as 2026-08-27-full-suite-report-loop-blames-its-own-commits.

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`648fbc4f`. Bisecting the landings since the last tested
commit (`4c7719e0`) over first-parent `main` blames one landing:

- **Landing:** `7edb9c73` — docs(issues): sticky HQ transcription preference
- **Workstream:** none (a direct commit to main)
- **Failing file:** `test/frontend/lib/ui-scan/annotations.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 393 - test/frontend/lib/ui-scan/annotations.doctest.md # time=1206.379ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-CPrpgK/checkout/beebox
  externalID: test/frontend/lib/ui-scan/annotations.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-CPrpgK/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-CPrpgK/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-CPrpgK/checkout/beebox/test/frontend/lib/ui-scan/annotations.doctest.md
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
    ok 1 - scan.doctest.md:59 — const composer = scan(` # time=14.504ms
    
    # Subtest: scan.doctest.md:120 — lines(scan(`
        ok 1 - (unnamed test)
        1..1
    ok 2 - scan.doctest.md:120 — lines(scan(` # time=0.692ms
    
    # Subtest: scan.doctest.md:138 — lines(scan(`
        ok 1 - (unnamed test)
        1..1
```

Reproduce at the blamed landing:

```bash
git log -1 7edb9c73
pnpm --dir beebox exec tap test/frontend/lib/ui-scan/annotations.doctest.md
```
