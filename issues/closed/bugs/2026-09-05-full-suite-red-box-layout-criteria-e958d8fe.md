---
title: "Full-suite red: test/core/migrations/one-root-migration.doctest.md, test/core/migrations/one-root-move-plan.doctest.md"
workstream: box-layout-criteria
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-layout-criteria — the hourly full-suite run on main
resolution: implemented
---

> Closed 2026-09-05: `one-root-move-plan.doctest.md`'s abort-on-unmappable-target case used a plain unknown directory as its unmappable fixture, and `009e00eec` (same workstream) had since made unknown plain directories map into `_content/` by design — so nothing threw and the test died on `err.message`. The fixture is now a dotfile entry, the one thing `mapV2Path` still leaves unmapped. `one-root-migration.doctest.md` passes in isolation (28 s); its red was the load the full-suite run was under.

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`8e676155`. Bisecting the landings since the last tested
commit (`b7c15bcc`) over first-parent `main` blames one landing:

- **Landing:** `e958d8fe` — Merge branch 'worktree-box-layout-criteria'
- **Workstream:** box-layout-criteria
- **Failing files:** `test/core/migrations/one-root-migration.doctest.md`, `test/core/migrations/one-root-move-plan.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 225 - test/core/migrations/one-root-migration.doctest.md # time=81599.728ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/beebox
  externalID: test/core/migrations/one-root-migration.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/beebox/test/core/migrations/one-root-migration.doctest.md
  jobId: 3
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/migrations/one-root-move-plan.doctest.md
    # Subtest: one-root-move-plan.doctest.md:35 — const root = await mkTmp();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 1 - one-root-move-plan.doctest.md:35 — const root = await mkTmp(); # time=11.277ms
    
    # Subtest: one-root-move-plan.doctest.md:78 — const root2 = await mkTmp();
        not ok 1 - Cannot read properties of undefined (reading 'message')
          ---
          stack: |
            Test.<anonymous> (test/core/migrations/one-root-move-plan.doctest.md:80:131)
          at:
            fileName: test/core/migrations/one-root-move-plan.doctest.md

not ok 226 - test/core/migrations/one-root-move-plan.doctest.md # time=656.577ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/beebox
  externalID: test/core/migrations/one-root-move-plan.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-QIoVqB/checkout/beebox/test/core/migrations/one-root-move-plan.doctest.md
  jobId: 1
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/migrations/one-root-ref-rewrite.doctest.md
    # Subtest: one-root-ref-rewrite.doctest.md:22 — const text = [
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 1 - one-root-ref-rewrite.doctest.md:22 — const text = [ # time=7.682ms
    
    # Subtest: one-root-ref-rewrite.doctest.md:46 — const figureText = [
        ok 1 - (unnamed test)
        1..1
    ok 2 - one-root-ref-rewrite.doctest.md:46 — const figureText = [ # time=0.72ms
    
    # Subtest: one-root-ref-rewrite.doctest.md:62 — const attachText = ["---", "entry: attach/sketch.js", "---", ""].join("\\n");
        ok 1 - (unnamed test)
        1..1
```

Reproduce at the blamed landing:

```bash
git log -1 e958d8fe
pnpm --dir beebox exec tap test/core/migrations/one-root-migration.doctest.md test/core/migrations/one-root-move-plan.doctest.md
```
