---
title: "Full-suite red after chore(issues): full-suite red after 7edb9c73: 1 test file failing"
workstream: unattached
area: callback-box
priority: important
filed-by: agent
discovered-by: agent
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`1383eece`. Bisecting the landings since the last tested
commit (`648fbc4f`) over first-parent `main` blames one landing:

- **Landing:** `1383eece` — chore(issues): full-suite red after 7edb9c73
- **Workstream:** none (a direct commit to main)
- **Failing file:** `test/frontend/lib/ui-scan/annotations.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 393 - test/frontend/lib/ui-scan/annotations.doctest.md # time=1106.769ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4VuLid/checkout/callback-box
  externalID: test/frontend/lib/ui-scan/annotations.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4VuLid/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4VuLid/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4VuLid/checkout/callback-box/test/frontend/lib/ui-scan/annotations.doctest.md
  jobId: 2
  exitCode: 1
  signal: null
  ...

# Subtest: test/frontend/lib/ui-scan/scan.doctest.md
    # Subtest: scan.doctest.md:59 — const composer = scan(`
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 1 - scan.doctest.md:59 — const composer = scan(` # time=7.104ms
    
    # Subtest: scan.doctest.md:120 — lines(scan(`
        ok 1 - (unnamed test)
        1..1
    ok 2 - scan.doctest.md:120 — lines(scan(` # time=0.684ms
    
    # Subtest: scan.doctest.md:138 — lines(scan(`
        ok 1 - (unnamed test)
        1..1
```

Reproduce at the blamed landing:

```bash
git log -1 1383eece
pnpm --dir callback-box exec tap test/frontend/lib/ui-scan/annotations.doctest.md
```
